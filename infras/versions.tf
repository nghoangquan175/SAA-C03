terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State is kept in this folder and committed to git (no secrets in it:
  # the login hash lives only in the CloudFront KeyValueStore).
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = { Project = "saa-practice" }
  }
}
