// A business rule refused the action (not a bug): carries the HTTP status and a
// message written for the person who hit it. Thrown inside transactions so the
// whole unit rolls back, and mapped to a response by errorResponse.

export class RuleError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "RuleError";
  }
}
