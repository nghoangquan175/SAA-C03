output "cloudflare_cname" {
  description = "Create this record in Cloudflare, Proxy status: DNS only (grey cloud)."
  value = {
    type   = "CNAME"
    name   = split(".", var.domain)[0]
    target = aws_cloudfront_distribution.site.domain_name
  }
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "distribution_arn" {
  description = "Scope cloudfront:CreateInvalidation of the GitHub deploy role (created by hand) to this ARN."
  value       = aws_cloudfront_distribution.site.arn
}

output "bucket" {
  value = aws_s3_bucket.site.bucket
}

output "kvs_arn" {
  value = aws_cloudfront_key_value_store.auth.arn
}

output "deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}
