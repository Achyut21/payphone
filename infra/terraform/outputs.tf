output "dynamodb_table_name" {
  value = aws_dynamodb_table.sessions.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.sessions.arn
}

output "users_table_name" {
  value = aws_dynamodb_table.users.name
}

output "users_table_arn" {
  value = aws_dynamodb_table.users.arn
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

# --- Cognito (M5) -----------------------------------------------------------

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_user_pool_client_secret" {
  value     = aws_cognito_user_pool_client.web.client_secret
  sensitive = true
}

# OIDC issuer URL for NextAuth's Cognito provider. NextAuth appends
# `/.well-known/openid-configuration` itself — do NOT include that suffix.
output "cognito_issuer" {
  value = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "cognito_hosted_ui_domain" {
  value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}
