export const required = <T>(obj: T | undefined, createError: () => string): T => {
  if (obj) {
    return obj
  }
  throw createError()
}
