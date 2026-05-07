resource "aws_iam_user" "app" {
  name = "${var.project_name}-app"
}

resource "aws_iam_access_key" "app" {
  user = aws_iam_user.app.name
}

data "aws_iam_policy_document" "ddb_access" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:DeleteItem",
      "dynamodb:Scan"
    ]
    resources = [
      aws_dynamodb_table.sessions.arn,
      aws_dynamodb_table.users.arn,
    ]
  }
}

resource "aws_iam_policy" "ddb_access" {
  name   = "${var.project_name}-ddb-access"
  policy = data.aws_iam_policy_document.ddb_access.json
}

resource "aws_iam_user_policy_attachment" "app_ddb" {
  user       = aws_iam_user.app.name
  policy_arn = aws_iam_policy.ddb_access.arn
}
