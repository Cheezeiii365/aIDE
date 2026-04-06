export interface Query extends AsyncIterable<unknown> {
  close(): void
}

export function query(): Query {
  return {
    close() {},
    async *[Symbol.asyncIterator]() {
      return
    },
  }
}
