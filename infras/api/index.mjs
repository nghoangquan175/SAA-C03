// Book pages API (Lambda function URL behind CloudFront OAC; the CloudFront login gate runs first).
//   GET  /api/book        -> { items: [{ qid, done, ok, choice, later, note, at }] }
//   PUT  /api/book/{qid}  -> saves one page; an older "at" never overwrites a newer one
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = process.env.TABLE_NAME;
const PK = 'book'; // single user: every page lives under one partition

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

// Keeps only known fields with sane types and sizes
export function cleanPage(input) {
  if (!input || typeof input !== 'object') return null;
  const at = Number(input.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const choice = Array.isArray(input.choice) ? input.choice.filter(n => Number.isInteger(n) && n >= 0 && n < 8).slice(0, 8) : [];
  return {
    done: input.done === true,
    ok: typeof input.ok === 'boolean' ? input.ok : null,
    choice,
    later: input.later === true,
    note: typeof input.note === 'string' ? input.note.slice(0, 20000) : '',
    at,
  };
}
export const QID = /^[a-z0-9-]{1,40}$/;

async function listPages() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': PK },
      ExclusiveStartKey,
    }));
    out.Items.forEach(({ pk, sk, ...rest }) => items.push({ qid: sk, ...rest }));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function putPage(qid, page) {
  try {
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: PK, sk: qid, ...page },
      ConditionExpression: 'attribute_not_exists(sk) OR #at <= :at',
      ExpressionAttributeNames: { '#at': 'at' },
      ExpressionAttributeValues: { ':at': page.at },
    }));
    return { saved: true };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return { saved: false, stale: true };
    throw err;
  }
}

export const handler = async event => {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || '';
  try {
    if (method === 'GET' && path === '/api/book') return json(200, { items: await listPages() });

    const m = path.match(/^\/api\/book\/([^/]+)$/);
    if (method === 'PUT' && m) {
      const qid = decodeURIComponent(m[1]);
      if (!QID.test(qid)) return json(400, { error: 'bad page id' });
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      let page;
      try { page = cleanPage(JSON.parse(raw)); } catch (_) { page = null; }
      if (!page) return json(400, { error: 'bad page body' });
      return json(200, await putPage(qid, page));
    }
    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'server error' });
  }
};
