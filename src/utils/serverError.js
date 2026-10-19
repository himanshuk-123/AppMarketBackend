// Log the real error server-side, send the client a generic message so DB /
// SDK internals (table names, connection details) never leak.
const serverError = (res, err, message = 'Something went wrong. Please try again.') => {
  console.error(`[${new Date().toISOString()}]`, err?.message || err?.error?.description || err);
  res.status(500).json({ message });
};

module.exports = { serverError };
