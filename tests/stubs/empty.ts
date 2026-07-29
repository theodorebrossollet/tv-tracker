// Stands in for the `server-only` package during tests. That package throws on
// import outside a React Server Component, which would stop tests from loading
// any of the modules that (correctly) guard themselves with it.
export {};
