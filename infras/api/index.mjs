// Study data API (Lambda function URL behind CloudFront OAC; the CloudFront login gate runs first).
// Items live in one table: pk = kind (book | qstat | attempt | meta), sk = id.
//   GET    /api/data          -> { book: [...], qstat: [...], attempt: [...], meta: [...] }, each item { id, ...fields }
//   POST   /api/data/batch    -> body { items: [{ kind, id, item }] } (max 100); an older "at" never overwrites a newer one
//   DELETE /api/data/{kind}   -> removes every item of a wipeable kind (qstat, attempt)
//   GET /api/book, PUT /api/book/{qid} are kept for pages opened before the switch to /api/data.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { KINDS, WIPEABLE, validId, cleanItem } from './rules.mjs';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = process.env.TABLE_NAME;
const MAX_BATCH = 100;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

async function listKind(kind, projection) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': kind },
      ProjectionExpression: projection,
      ExclusiveStartKey,
    }));
    out.Items.forEach(({ pk, sk, ...rest }) => items.push({ id: sk, ...rest }));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function putItem(kind, id, item) {
  try {
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: kind, sk: id, ...item },
      ConditionExpression: 'attribute_not_exists(sk) OR #at <= :at',
      ExpressionAttributeNames: { '#at': 'at' },
      ExpressionAttributeValues: { ':at': item.at },
    }));
    return 'saved';
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return 'stale';
    throw err;
  }
}

async function wipeKind(kind) {
  const keys = (await listKind(kind, 'pk, sk')).map(({ id }) => ({ pk: kind, sk: id }));
  for (let i = 0; i < keys.length; i += 25) {
    let requests = keys.slice(i, i + 25).map(Key => ({ DeleteRequest: { Key } }));
    for (let tries = 0; requests.length && tries < 5; tries++) {
      const out = await db.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests } }));
      requests = (out.UnprocessedItems && out.UnprocessedItems[TABLE]) || [];
      if (requests.length) await new Promise(r => setTimeout(r, 100 * 2 ** tries));
    }
    if (requests.length) throw new Error('wipe did not finish');
  }
  return keys.length;
}

function readBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  try { return JSON.parse(raw); } catch (_) { return undefined; }
}

export const handler = async event => {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || '';
  try {
    if (method === 'GET' && path === '/api/data') {
      const out = {};
      for (const kind of KINDS) out[kind] = await listKind(kind);
      return json(200, out);
    }

    if (method === 'POST' && path === '/api/data/batch') {
      const body = readBody(event);
      const list = body && Array.isArray(body.items) ? body.items : null;
      if (!list || list.length > MAX_BATCH) return json(400, { error: `send 1-${MAX_BATCH} items` });
      const results = [];
      for (const { kind, id, item } of list) {
        const clean = KINDS.includes(kind) && typeof id === 'string' && validId(kind, id) ? cleanItem(kind, item) : null;
        results.push({ kind, id, result: clean ? await putItem(kind, id, clean) : 'invalid' });
      }
      return json(200, { results });
    }

    const wipe = path.match(/^\/api\/data\/([a-z]+)$/);
    if (method === 'DELETE' && wipe) {
      if (!WIPEABLE.includes(wipe[1])) return json(400, { error: 'this kind cannot be wiped' });
      return json(200, { deleted: await wipeKind(wipe[1]) });
    }

    if (method === 'GET' && path === '/api/book') {
      return json(200, { items: (await listKind('book')).map(({ id, ...rest }) => ({ qid: id, ...rest })) });
    }
    const page = path.match(/^\/api\/book\/([^/]+)$/);
    if (method === 'PUT' && page) {
      const qid = decodeURIComponent(page[1]);
      if (!validId('book', qid)) return json(400, { error: 'bad page id' });
      const clean = cleanItem('book', readBody(event));
      if (!clean) return json(400, { error: 'bad page body' });
      const result = await putItem('book', qid, clean);
      return json(200, result === 'saved' ? { saved: true } : { saved: false, stale: true });
    }

    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'server error' });
  }
};
