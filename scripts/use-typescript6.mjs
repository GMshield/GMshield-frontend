// Loaded with `node --import` before a tool that needs the TypeScript compiler API.
// TypeScript 7 (the project's compiler) has no such API, so for this process every import or
// require of `typescript` resolves to the TypeScript 6 companion, @typescript/typescript6.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript' || specifier.startsWith('typescript/')) {
      return nextResolve(specifier.replace(/^typescript/, '@typescript/typescript6'), context);
    }
    return nextResolve(specifier, context);
  },
});
