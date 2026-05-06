output "dynamodb_table_name" {
  value = aws_dynamodb_table.sessions.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.sessions.arn
}

output "aws_region" {
  value = var.aws_region
}

output "app_access_key_id" {
  value     = aws_iam_access_key.app.id
  sensitive = true
}

output "app_secret_access_key" {
  value     = aws_iam_access_key.app.secret
  sensitive = true
}
