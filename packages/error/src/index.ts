import { EOL } from "os";

export interface ErrorOptions {
  cause?: any;
}

//Note: This class only exists for compatibility with some old Javascript
//stuff that avoided using Error directly for whatever reason.  Eventually
//it should be eliminated.

export class TruffleError extends Error {
  private _cause: any;
  private _originalStack: string | undefined;

  get cause(): any {
    return this._cause;
  }

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this._cause = options?.cause;

    this._originalStack = this.stack;

    Object.defineProperties(this, {
      stack: {
        get: () => {
          const stacks = [this._originalStack];

          for (let cause = this.cause; cause; cause = cause.cause) {
            if (cause instanceof TruffleError) {
              stacks.push(`Caused by: ${cause._originalStack}`);
            } else {
              stacks.push(`Caused by: ${cause.stack}`);
            }
          }

          return stacks.join(EOL);
        }
      }
    });
  }
}

export default TruffleError;
