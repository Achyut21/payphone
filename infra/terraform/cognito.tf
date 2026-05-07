data "aws_caller_identity" "current" {}

resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-users"

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Verify your PayPhone account"
    email_message        = "Welcome to PayPhone. Your verification code is {####}."
  }
}

# Hosted UI requires a Cognito-hosted domain. NextAuth redirects users to
# `/oauth2/authorize` on this domain, which renders the Hosted UI signup/
# signin form. The domain prefix must be unique within the AWS region for
# this account; suffixing with the account id makes it deterministic across
# applies and avoids collisions if `payphone` is ever taken.
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = true

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  callback_urls = [
    "http://localhost:3000/api/auth/callback/cognito",
    # M5 Phase 7: Amplify-hosted production URL. The path
    # `/api/auth/callback/cognito` is a NextAuth convention — the
    # `cognito` segment matches the provider id we pass to NextAuth.
    "https://main.d3vbs5akc8zis2.amplifyapp.com/api/auth/callback/cognito",
  ]

  logout_urls = [
    "http://localhost:3000",
    "https://main.d3vbs5akc8zis2.amplifyapp.com",
  ]

  supported_identity_providers = ["COGNITO"]

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true
}
