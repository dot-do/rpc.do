# Contributing to rpc.do

Thank you for your interest in contributing to rpc.do! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- pnpm 9 (package manager)

### Getting Started

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/rpc.do.git
   cd rpc.do
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Build the project**
   ```bash
   pnpm build
   ```

4. **Run tests**
   ```bash
   pnpm test
   ```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages |
| `pnpm dev` | Watch mode for development |
| `pnpm test` | Run all tests |
| `pnpm test:e2e` | Run end-to-end tests |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm bench` | Run performance benchmarks |

## Code Style Guidelines

### TypeScript

- We use **TypeScript** with strict mode enabled
- Target ES2022 with ESNext module resolution
- All code must pass type checking (`pnpm typecheck`)

### Configuration

The project uses strict TypeScript settings including:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`

### Formatting Conventions

- Use 2-space indentation
- Use single quotes for strings
- Include trailing commas in multi-line structures
- Prefer `const` over `let` where possible
- Use descriptive variable and function names
- Document public APIs with JSDoc comments

### Error Handling

- Use `catch (error: unknown)` instead of `catch (error: any)`
- Provide meaningful error messages
- Use typed error classes from `rpc.do/errors` where appropriate

## Test Requirements

### All Tests Must Pass

Before submitting a PR, ensure:

```bash
pnpm typecheck  # Type checking passes
pnpm build      # Build succeeds
pnpm test       # All tests pass
```

### Adding Tests

- Add tests for all new features and bug fixes
- Place tests alongside source files with `.test.ts` extension
- Use Vitest as the testing framework
- Aim for meaningful test coverage, focusing on edge cases

### Test Structure

```typescript
import { describe, it, expect } from 'vitest'

describe('FeatureName', () => {
  it('should handle the expected case', () => {
    // Arrange
    // Act
    // Assert
  })

  it('should handle edge cases', () => {
    // ...
  })
})
```

## Pull Request Process

### Branch Naming

Use descriptive branch names:
- `feat/add-new-transport` - New features
- `fix/websocket-reconnection` - Bug fixes
- `docs/update-getting-started` - Documentation
- `refactor/simplify-auth-flow` - Refactoring
- `test/add-integration-tests` - Test additions

### Commit Messages

Write clear, concise commit messages:
- Use imperative mood ("Add feature" not "Added feature")
- Keep the subject line under 72 characters
- Reference issues when applicable (`Fix #123`)

Examples:
```
feat: Add WebSocket heartbeat support
fix: Handle connection timeout correctly
docs: Update authentication examples
test: Add unit tests for RPC proxy
```

### PR Guidelines

1. **Keep PRs focused** - One feature or fix per PR
2. **Update documentation** - If your change affects the public API
3. **Add tests** - For new functionality or bug fixes
4. **Run CI locally** - Before pushing:
   ```bash
   pnpm typecheck && pnpm build && pnpm test
   ```

### Review Process

1. Open a PR against the `main` branch
2. Ensure all CI checks pass
3. Request review from maintainers
4. Address any feedback
5. Once approved, a maintainer will merge your PR

## Issue Reporting

### Before Opening an Issue

1. Search existing issues to avoid duplicates
2. Check the [documentation](./docs/) for answers
3. Try to reproduce with a minimal example

### Bug Reports

Include:
- **Version** - rpc.do and Node.js versions
- **Environment** - Browser, Cloudflare Workers, Node.js, etc.
- **Steps to reproduce** - Minimal code example
- **Expected behavior** - What should happen
- **Actual behavior** - What actually happens
- **Error messages** - Full stack traces if applicable

### Feature Requests

Include:
- **Use case** - What problem are you trying to solve?
- **Proposed solution** - How you envision the feature working
- **Alternatives** - Other approaches you've considered

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. All contributors are expected to:

- Be respectful and considerate
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other contributors

Unacceptable behavior includes harassment, trolling, or any conduct that creates an unwelcoming environment. Violations may result in being banned from the project.

## Questions?

- Open a [GitHub Discussion](https://github.com/dot-do/rpc.do/discussions)
- Check existing [documentation](./docs/)
- Review the [API Reference](./README.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
