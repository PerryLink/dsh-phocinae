/**
 * Structured domain errors.
 *
 * Every failure the plugin can produce is one of these, so callers can branch on
 * `code` instead of matching message text. Messages stay actionable: they name
 * the endpoint and the fix, because the common failure is "the local server is
 * not running" and the user has to be told that, not shown a fetch stack.
 */

/** Error codes; stable strings that appear in logs and tests. */
export const ERROR_CODES = Object.freeze({
  /** Endpoint refused the connection, timed out, or aborted. */
  serviceUnavailable: 'PHOCINAE_SERVICE_UNAVAILABLE',
  /** Endpoint answered with a non-2xx status. */
  serviceError: 'PHOCINAE_SERVICE_ERROR',
  /** Endpoint answered 2xx but the body did not match the answer contract. */
  badResponse: 'PHOCINAE_BAD_RESPONSE',
  /** Caller-supplied arguments failed validation before any request was made. */
  invalidArguments: 'PHOCINAE_INVALID_ARGUMENTS',
  /** Configuration was rejected at load time. */
  invalidConfig: 'PHOCINAE_INVALID_CONFIG',
})

export class PhocinaeError extends Error {
  /**
   * @param code - one of {@link ERROR_CODES}
   * @param message - actionable, user-facing text
   * @param details - structured extras (endpoint, status, cause message)
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'PhocinaeError'
    this.code = code
    this.details = details
  }
}

/** The decision service could not be reached or did not answer in time. */
export function serviceUnavailable(endpoint, timeoutMs, cause) {
  return new PhocinaeError(
    ERROR_CODES.serviceUnavailable,
    `the phocinae decision service at ${endpoint} could not be reached within ` +
      `${timeoutMs} ms; start it with \`python -m phocinae.main\` (see the ` +
      `README's "Running the decision service" section)`,
    { endpoint, timeoutMs, cause: cause instanceof Error ? cause.message : String(cause) },
  )
}

/** The decision service answered, but not with a success status. */
export function serviceError(endpoint, status, body) {
  return new PhocinaeError(
    ERROR_CODES.serviceError,
    `the phocinae decision service at ${endpoint} answered HTTP ${status}` +
      (body ? `: ${body}` : ''),
    { endpoint, status },
  )
}

/** The decision service answered 2xx with an unusable body. */
export function badResponse(endpoint, detail) {
  return new PhocinaeError(
    ERROR_CODES.badResponse,
    `the phocinae decision service at ${endpoint} returned an unusable answer: ${detail}`,
    { endpoint, detail },
  )
}

/** A caller-supplied argument was rejected. */
export function invalidArguments(message, details = {}) {
  return new PhocinaeError(ERROR_CODES.invalidArguments, message, details)
}

/** Configuration was rejected at load time. */
export function invalidConfig(message, details = {}) {
  return new PhocinaeError(ERROR_CODES.invalidConfig, message, details)
}
