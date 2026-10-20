# Study data API (book pages, notes, exam history, per-question stats, bookmarks):
# DynamoDB table + Lambda function URL, reachable only through CloudFront (/api/*).
# CloudFront signs requests with OAC, and the login gate function runs on the /api/* behavior too.

resource "aws_dynamodb_table" "book" {
  name                        = "saa-book"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Notes are hand-written: keep 35 days of restore points.
  point_in_time_recovery {
    enabled = true
  }
}

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/api"
  output_path = "${path.module}/.build/api.zip"
}

data "aws_iam_policy_document" "api_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "saa-book-api"
  description        = "Lambda behind ${var.domain}/api"
  assume_role_policy = data.aws_iam_policy_document.api_trust.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/saa-book-api"
  retention_in_days = 14
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "BookTable"
    actions   = ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:BatchWriteItem"]
    resources = [aws_dynamodb_table.book.arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "book-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_lambda_function" "api" {
  function_name    = "saa-book-api"
  description      = "Book pages and notes for ${var.domain}"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 256
  timeout          = 10

  environment {
    variables = { TABLE_NAME = aws_dynamodb_table.book.name }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy.api]
}

# AWS_IAM: only signed requests (CloudFront OAC) can call the URL directly.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}

# CloudFront needs both permissions to invoke a function URL through OAC.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.site.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "saa-book-api"
  description                       = "CloudFront access to the saa-book-api function URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Forwards cookies, query strings and headers, but not Host (the function URL must see its own host).
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}
