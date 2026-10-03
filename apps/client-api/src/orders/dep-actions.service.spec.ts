import { DepActionsService } from './dep-actions.service';

jest.mock('@org/database', () => ({}));
jest.mock('../credentials/credentials.service.js', () => ({ CredentialsService: class {} }));
jest.mock('../netsuite/netsuite.service.js', () => ({ NetsuiteService: class {} }));

describe('DepActionsService.submissionOutcome', () => {
  const service = new DepActionsService({} as any, {} as any);
  const outcome = (response: unknown) => (service as any).submissionOutcome(response);

  it('accepts a response with an Apple transaction id', () => {
    expect(outcome({ deviceEnrollmentTransactionId: 'abc' })).toEqual({ accepted: true, errorMessage: null });
  });

  it('rejects a response carrying an error even with HTTP 200', () => {
    expect(outcome({ errorCode: 'E1', errorMessage: 'Bad customer' })).toEqual({
      accepted: false,
      errorMessage: 'Bad customer',
    });
  });

  it('rejects a response with no transaction id and gives a fallback message', () => {
    expect(outcome({})).toEqual({ accepted: false, errorMessage: 'Apple did not accept the submission.' });
  });
});
