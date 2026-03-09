function asyncHandler(handler) {
  return async function wrapped(req, res, next) {
    try {
      await handler(req, res, next)
    } catch (error) {
      next(error)
    }
  }
}

module.exports = { asyncHandler }
