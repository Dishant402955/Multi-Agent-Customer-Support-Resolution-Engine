# Troubleshooting Guide

## Export feature
If a customer reports the export feature failing, erroring, or not downloading
— even when they do not quote an error code — the most common cause is
`ERR_EXPORT_TIMEOUT`. Synchronous exports are capped at 30 seconds, so exports
of large datasets time out before the file is built. The fix is the
asynchronous export ("Email me the file"), which builds the export in the
background and is the supported path for large accounts. A failed export never
affects the customer's stored data.

## Authentication errors
`ERR_AUTH_401` means the request was rejected because the API key is missing,
expired, or lacks the required scope. Keys can be regenerated under
Settings > Developer. Most integration failures trace back to a missing
`read` scope on the key.

## Rate limiting
`ERR_RATE_LIMIT` indicates the account exceeded its requests-per-minute quota.
This is recoverable: clients should back off and retry. Sustained limits mean
the account needs a quota increase.

## When to escalate
If an error code is not in the runbook, or the recommended fix does not resolve
the issue, the case should be escalated to engineering with the trace id.

## Data safety
Errors in the export, reporting, or integration layers are read-only and do not
modify or delete customer data. Reassure customers their data is intact.
