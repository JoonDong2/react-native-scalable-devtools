let nextRequestId = 0;

export function createRequestId(): string {
  nextRequestId += 1;
  return `react-query-${Date.now().toString(36)}-${nextRequestId.toString(
    36
  )}`;
}
