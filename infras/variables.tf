variable "region" {
  description = "us-east-1: CloudFront only accepts ACM certificates from this Region."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile of the saa-terraform IAM user."
  type        = string
  default     = "saa"
}

variable "domain" {
  type    = string
  default = "saa.quannh.xyz"
}

variable "certificate_arn" {
  description = "Existing ACM certificate for *.quannh.xyz in us-east-1 (expires 2027-04-15)."
  type        = string
  default     = "arn:aws:acm:us-east-1:191518191350:certificate/36e20afb-01a4-4fe9-9d63-603cfc96c98c"
}

variable "bucket_name" {
  description = "No dots: dotted names break HTTPS to the bucket's virtual-hosted endpoint."
  type        = string
  default     = "saa-quannh-xyz-site"
}

variable "github_repo" {
  description = "owner/name of the repo that deploys the site."
  type        = string
  default     = "nghoangquan175/SAA-C03"
}

variable "github_oidc_sub_prefix" {
  description = <<-EOT
    OIDC `sub` prefix of the repo allowed to assume the deploy role. The repo uses GitHub's
    immutable subject format (owner@owner_id/repo@repo_id). Check it with:
    gh api repos/nghoangquan175/SAA-C03/actions/oidc/customization/sub
  EOT
  type        = string
  default     = "repo:nghoangquan175@111145927/SAA-C03@1425362907"
}
