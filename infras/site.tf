# Private S3 bucket behind CloudFront (OAC), login gate in a CloudFront Function.

# ---------- S3 ----------
resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Only this distribution may read objects.
data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid       = "CloudFrontReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}

# ---------- Login gate ----------
# Holds one key, auth_hash, written by scripts/set-password.sh (never by Terraform,
# so the hash stays out of the committed state).
resource "aws_cloudfront_key_value_store" "auth" {
  name    = "saa-auth"
  comment = "Login hash for ${var.domain}"
}

resource "aws_cloudfront_function" "auth" {
  name    = "saa-auth-gate"
  runtime = "cloudfront-js-2.0"
  comment = "Blocks other hostnames, redirects to /login.html unless the saa_auth cookie matches the stored hash"
  publish = true
  code = replace(
    replace(file("${path.module}/auth-function.js"), "__KVS_ID__", aws_cloudfront_key_value_store.auth.id),
    "__SITE_HOST__", var.domain
  )

  key_value_store_associations = [aws_cloudfront_key_value_store.auth.arn]
}

# ---------- CloudFront ----------
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "saa-site"
  description                       = "CloudFront access to ${var.bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "SAA-C03 practice (${var.domain})"
  aliases             = [var.domain]
  default_root_object = "index.html"
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  # North America, Europe, Asia: covers Vietnam at a lower price than PriceClass_All.
  price_class = "PriceClass_200"

  origin {
    origin_id                = "s3-site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "s3-site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    # Runs before the cache, so cached files are never served without a valid login.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.auth.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
