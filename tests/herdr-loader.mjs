// Resolves "herdr" to the stub above; registered by tests/register.mjs.
export async function resolve(specifier, context, next) {
  if (specifier === "herdr") return { url: new URL("./herdr-stub.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
