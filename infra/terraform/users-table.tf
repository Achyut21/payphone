resource "aws_dynamodb_table" "users" {
  name         = "${var.project_name}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cognito_sub"

  attribute {
    name = "cognito_sub"
    type = "S"
  }

  # No TTL — user rows are persistent. The sessions table TTLs on
  # `expires_at` because sessions are ephemeral; users are not.

  point_in_time_recovery {
    enabled = false # cost-saving for hackathon, mirrors sessions table
  }
}
