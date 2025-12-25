# Contributing to AgentLedger

Thank you for your interest in contributing to AgentLedger! This document provides guidelines and information for contributors.

## Code of Conduct

Please be respectful and professional in all interactions. We are committed to providing a welcoming environment for everyone.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 8 or higher
- Git

### Setup

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/agentledger.git
   cd agentledger
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run tests to verify setup:
   ```bash
   npm test
   ```

## Project Structure

```
agentledger/
├── packages/
│   ├── core/           # Core audit logging (agentledger-core)
│   ├── openai/         # OpenAI integration (agentledger-openai)
│   ├── anthropic/      # Anthropic integration (agentledger-anthropic)
│   ├── langchain/      # LangChain integration (agentledger-langchain)
│   └── cli/            # CLI tools (agentledger-cli)
├── examples/           # Usage examples
├── ARCHITECTURE.md     # Architecture documentation
├── CHANGELOG.md        # Version history
└── README.md           # Main documentation
```

## Development Workflow

### Making Changes

1. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the coding standards below

3. Run tests and linting:
   ```bash
   npm test
   npm run lint
   ```

4. Commit your changes with a descriptive message:
   ```bash
   git commit -m "feat: add new validation helper for timestamps"
   ```

5. Push to your fork and create a pull request

### Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test additions or modifications
- `refactor:` Code refactoring
- `chore:` Maintenance tasks

Examples:
```
feat: add EU AI Act export format
fix: correct hash chain verification for empty entries
docs: update README with new API examples
test: add integration tests for S3 storage
```

## Coding Standards

### TypeScript

- Use TypeScript for all source files
- Enable strict mode
- Prefer explicit types over inference for public APIs
- Use interfaces for object shapes, types for unions/primitives

```typescript
// Good
interface ModelCallParams {
  provider: string;
  modelId: string;
  promptHash: string;
}

// Also good for unions
type ComplianceFramework = 'FINRA_4511' | 'EU_AI_ACT' | 'HIPAA';
```

### Error Handling

- Use custom error classes from `agentledger-core`
- Provide meaningful error messages
- Include relevant context in error details

```typescript
import { ValidationError } from 'agentledger-core';

if (!isValidHash(hash)) {
  throw new ValidationError(
    'Invalid hash format',
    { field: 'promptHash', receivedValue: hash }
  );
}
```

### Testing

- Write tests for all new functionality
- Place tests in `__tests__` directories
- Use descriptive test names

```typescript
describe('Ledger', () => {
  describe('logModelCall', () => {
    test('logs model call with required fields', async () => {
      // Test implementation
    });

    test('throws ValidationError for missing provider', async () => {
      // Test error case
    });
  });
});
```

### Documentation

- Add JSDoc comments for public APIs
- Include examples in documentation
- Update README if adding new features

```typescript
/**
 * Validates that a value is a SHA-256 hash (64 hex characters)
 *
 * @param value - The value to validate
 * @param fieldName - Name of the field (for error messages)
 * @returns The validated hash string
 * @throws ValidationError if the value is not a valid hash
 *
 * @example
 * const hash = validateHash(input, 'promptHash');
 */
export function validateHash(value: unknown, fieldName: string): string {
  // Implementation
}
```

## Pull Request Process

1. **Title**: Use a descriptive title following commit conventions
2. **Description**: Explain what changes you made and why
3. **Tests**: Ensure all tests pass
4. **Review**: Wait for code review and address feedback
5. **Merge**: Maintainers will merge approved PRs

### PR Checklist

- [ ] Tests added/updated for changes
- [ ] Documentation updated if needed
- [ ] All tests passing (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] Commit messages follow conventions

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific package tests
npm test -- --testPathPatterns="packages/core"

# Run with coverage
npm run test:coverage

# Watch mode for development
npm test -- --watch
```

### Writing Tests

- Use Jest's `describe`/`test` structure
- Test both success and error cases
- Mock external dependencies

```typescript
import { Ledger, hashContent } from 'agentledger-core';

describe('Ledger', () => {
  let ledger: Ledger;

  beforeEach(() => {
    ledger = new Ledger({
      orgId: 'test-org',
      agentId: 'test-agent',
      agentVersion: '1.0.0',
      environment: 'test',
    });
  });

  test('example test', async () => {
    await ledger.start({ type: 'user', identifier: 'test-user' });
    // Test assertions
  });
});
```

## Package Development

### Adding a New Package

1. Create the package directory:
   ```bash
   mkdir -p packages/new-package/src
   mkdir -p packages/new-package/__tests__
   ```

2. Create `package.json`:
   ```json
   {
     "name": "agentledger-new-package",
     "version": "1.0.0",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "build": "tsc -p tsconfig.build.json",
       "prepublishOnly": "npm run build"
     },
     "dependencies": {
       "agentledger-core": "^1.0.0"
     }
   }
   ```

3. Create TypeScript configs (see existing packages for examples)

4. Add to the workspace in root `package.json`

5. Write tests

6. Update documentation

## Releasing

Releases are handled by maintainers:

1. Update version numbers in package.json files
2. Update CHANGELOG.md
3. Create a git tag
4. Publish to npm

## Getting Help

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Join discussions in pull requests

## Recognition

Contributors will be recognized in:
- GitHub contributors list
- CHANGELOG.md for significant contributions
- README.md for major contributions

Thank you for contributing to AgentLedger!
