export class PricingError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}
