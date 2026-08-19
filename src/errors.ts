/**
 * Typed exceptions for cli-anything-contentstudio (TS port).
 *
 * Every HTTP failure surfaces as one of these so the CLI layer can format
 * human + JSON error envelopes consistently and exit non-zero.
 */

export class ContentStudioError extends Error {
  readonly errorType: string = "ContentStudioError";
  readonly exitCode: number = 1;
  readonly httpStatus?: number;
  readonly payload?: unknown;
  readonly hint?: string;

  constructor(
    message: string,
    opts: { httpStatus?: number; payload?: unknown; hint?: string } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.httpStatus = opts.httpStatus;
    this.payload = opts.payload;
    this.hint = opts.hint;
  }

  toDict(): Record<string, unknown> {
    const d: Record<string, unknown> = {
      type: this.errorType,
      message: this.message,
    };
    if (this.httpStatus !== undefined) d.http_status = this.httpStatus;
    if (this.hint) d.hint = this.hint;
    if (this.payload !== undefined) d.response = this.payload;
    return d;
  }
}

export class ConfigError extends ContentStudioError {
  readonly errorType = "ConfigError";
}

export class AuthError extends ContentStudioError {
  readonly errorType = "AuthError";
  readonly exitCode = 2;
}

export class NotFoundError extends ContentStudioError {
  readonly errorType = "NotFoundError";
  readonly exitCode = 3;
}

export class ValidationError extends ContentStudioError {
  readonly errorType = "ValidationError";
  readonly exitCode = 4;
}

export class RateLimitError extends ContentStudioError {
  readonly errorType = "RateLimitError";
  readonly exitCode = 5;
}

export class BackendError extends ContentStudioError {
  readonly errorType = "BackendError";
  readonly exitCode = 6;
}

/**
 * HTTP 409 — a conflict with existing state. Used for duplicate resources
 * (`add/bluesky`, `add/facebook-group`) and for inbox sends whose delivery
 * outcome is undetermined, where the send may already have been delivered.
 */
export class ConflictError extends ContentStudioError {
  readonly errorType = "ConflictError";
  readonly exitCode = 7;
}

/**
 * Map an HTTP status code to the appropriate error subclass.
 */
export function fromHttpStatus(
  status: number,
  message: string,
  payload?: unknown,
): ContentStudioError {
  if (status === 401 || status === 403) {
    return new AuthError(message, {
      httpStatus: status,
      payload,
      hint: "Run `contentstudio auth:login --api-key cs_...` to set a valid API key.",
    });
  }
  if (status === 404) {
    return new NotFoundError(message, { httpStatus: status, payload });
  }
  if (status === 422) {
    return new ValidationError(message, { httpStatus: status, payload });
  }
  if (status === 429) {
    return new RateLimitError(message, {
      httpStatus: status,
      payload,
      hint: "Rate limit reached. Wait a moment and retry.",
    });
  }
  if (status === 409) {
    return new ConflictError(message, {
      httpStatus: status,
      payload,
      hint:
        "The resource already exists, or a send's delivery outcome is " +
        "undetermined. Before retrying a message or comment send, check " +
        "whether it already went through.",
    });
  }
  if (status >= 500) {
    return new BackendError(message, { httpStatus: status, payload });
  }
  return new ContentStudioError(message, { httpStatus: status, payload });
}

/**
 * HTTP 403 with `error_code: IMAGE_CREDIT_LIMIT_EXCEEDED` — the workspace is out
 * of AI image credits. Distinct from AuthError (which 403 otherwise maps to)
 * because "top up credits" and "fix your API key" are different actions, and an
 * agent that re-runs `auth:login` on this will loop forever.
 */
export class CreditLimitError extends ContentStudioError {
  readonly errorType = "CreditLimitError";
  readonly exitCode = 8;
}
