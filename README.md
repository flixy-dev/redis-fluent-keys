# Redis fluent keys: Finally, Typesafe Redis Keys You'll Actually Enjoy! ✨

![GitHub Repo stars](https://img.shields.io/github/stars/flixy-dev/redis-fluent-keys?style=social)
![npm](https://img.shields.io/npm/v/@flixy-dev/redis-fluent-keys?style=plastic)
![GitHub](https://img.shields.io/github/license/flixy-dev/redis-fluent-keys?style=plastic)
![npm](https://img.shields.io/npm/dy/@flixy-dev/redis-fluent-keys?style=plastic)
![npm](https://img.shields.io/npm/dw/@flixy-dev/redis-fluent-keys?style=plastic)
![GitHub top language](https://img.shields.io/github/languages/top/flixy-dev/redis-fluent-keys?style=plastic)

**(Because stringly-typed keys are just asking for trouble, right?)**

Ugh, Redis keys. We all use 'em, but managing them can be a pain:

*   Typo in `users:profile:usr_123` vs `user:profile:user_123`? Good luck finding that bug! 😭
*   Inconsistent naming conventions across your app? Chaos!
*   Need to refactor a key structure? Prepare for a risky find-and-replace adventure. 😬
*   Want to include a user ID or timestamp? Hope you format that template string correctly *every single time*.

**Enough is enough!** This little library helps you define your Redis key structures in one place, using plain TypeScript, and gives you back **fully typesafe functions** to generate those keys.

**What you get:**

*   ✅ **Autocomplete Heaven:** Define your keys, get autocomplete for paths and placeholders.
*   🔒 **Bulletproof Type Safety:** Pass the wrong type (like a `number` for a `userId` string)? TypeScript yells at you *before* you deploy. Forget a placeholder? Compile error!
*   🌳 **Organized Structure:** Define keys in a nested way that makes sense for your domain.
*   ⚙️ **Refactor with Confidence:** Change a key definition in one place, TypeScript guides you to fix all the usages.
*   😎 **Awesome DX:** Simple API, minimal boilerplate, focuses on getting the job done cleanly.

Works perfectly with [`ioredis`](https://github.com/luin/ioredis) or any other Redis client that just needs the final key string.

## Installation

```bash
npm install @flixy-dev/redis-fluent-keys --save
# or
yarn add @flixy-dev/redis-fluent-keys
# or
pnpm add @flixy-dev/redis-fluent-keys
bun add @flixy-dev/redis-fluent-keys
```

# Quick Start
Let's see how easy this is:

```ts
// src/redis-keys.ts
import { createKeyBuilder, p } from 'redis-fluent-keys';

// 1. Create a key builder instance (separator defaults to ':')
const keyBuilder = createKeyBuilder();
// const keyBuilder = createKeyBuilder({ separator: '__' }); // Custom separator!

// 2. Define your key schema
export const redisKeys = keyBuilder({
  // A simple static key
  config: {
    cacheVersion: ['config', 'cacheVersion'], // -> config:cacheVersion
  },

  // Keys related to users
  users: {
    // A key with a dynamic part (placeholder)
    profile: ['users', p('userId'), 'profile'], // -> users:{userId}:profile

    // Another static one nested
    allActiveSet: ['users', 'all', 'active'], // -> users:all:active
  },
});

// -------------------------------------

// src/some-service.ts
import Redis from 'ioredis';
import { redisKeys } from './redis-keys'; // Import your defined keys

const redis = new Redis(); // Your ioredis instance

async function getUserProfile(id: string) {
  // 3. Use the typesafe function! ✨
  const key = redisKeys.users.profile({ userId: id });
  // key will be "users:id:profile"

  console.log(`Fetching from Redis key: ${key}`);
  const profileData = await redis.hgetall(key);

  // Trying to misuse it? TypeScript catches it!
  // const wrongKey = redisKeys.users.profile({}); // TS Error: userId missing!
  // const wrongKey2 = redisKeys.users.profile({ userId: 123 }); // TS Error: userId needs string!

  return profileData;
}

async function getCacheVersion() {
    // No arguments needed for static keys!
    const key = redisKeys.config.cacheVersion();
    // key will be "config:cacheVersion"
    return redis.get(key);
}

getUserProfile('usr_987');
getCacheVersion();
```

See? Define once, use everywhere safely!

# Features Deep Dive Placeholders (`p`, `p.number`, `p.boolean`)

Dynamic parts are the heart of most Redis keys. We use the `p()` helper:
`p('placeholderName')`: Creates a placeholder expecting a string. Infers the name `"placeholderName"` literally for the argument object. (This is the default and most common).
`p.number('placeholderName')`: Creates a placeholder expecting a number.
`p.boolean('placeholderName')`: Creates a placeholder expecting a boolean (will be converted to "true" or "false" in the key).

```ts
const keys = createKeyBuilder()({
    user: p('userId'), // -> {userId} (string)
    productStock: ['products', p.number('productId'), 'stock'], // -> products:{productId}:stock
    featureFlag: ['features', p('flagName'), p.boolean('isEnabled')], // -> features:{flagName}:{isEnabled}
});

const userKey = keys.user({ userId: 'user-123' }); // "user-123"
const stockKey = keys.productStock({ productId: 55 }); // "products:55:stock"
const flagKey = keys.featureFlag({ flagName: 'newUI', isEnabled: true }); // "features:newUI:true"

// Compile-time errors:
// const badStock = keys.productStock({ productId: 'abc' }); // TS Error! Expects number
// const badFlag = keys.featureFlag({ flagName: 'oldUI' }); // TS Error! isEnabled missing
```

# Nesting (The Easy Way)

Organize your keys logically using nested objects. The object keys automatically become part of the prefix.

```ts
const keys = createKeyBuilder()({
  users: { // "users" becomes a prefix
    all: ['all'], // -> users:all
    settings: { // "settings" becomes a prefix
      byUser: [p('userId')], // -> users:settings:{userId}
      notifications: { // "notifications" becomes a prefix
          email: ['email', p('userId')], // -> users:settings:notifications:email:{userId}
      }
    }
  },
  cache: { // "cache" becomes a prefix
    images: ['images'], // -> cache:images
  }
});

const settingsKey = keys.users.settings.byUser({ userId: 'u-456' });
// "users:settings:u-456"
const emailKey = keys.users.settings.notifications.email({ userId: 'u-789' });
// "users:settings:notifications:email:u-789"
const imgKey = keys.cache.images();
// "cache:images"
```

# Parameterized Nesting (`parameterize`)

Sometimes, the nesting level itself needs a dynamic value (like accessing keys for a *specific* user). That's where parameterize comes in!

Think about it: how would you define keys like `user:{userId}:profile` AND `user:{userId}:settings` using the nesting above? You can't easily make `user:{userId}` the prefix directly.

`parameterize` solves this:

```ts
import { createKeyBuilder, p, parameterize } from 'redis-fluent-keys';

const keys = createKeyBuilder()({
  // Parameterize the 'user' level by userId
  user: parameterize(p('userId'), { // Now requires { userId: string } to access inner keys
    // Inside here, "user:{userId}" is the implicit prefix!

    profile: ['profile'], // Definition is just the final part
    // -> user:{userId}:profile

    settings: ['settings'], // Definition is just the final part
    // -> user:{userId}:settings

    orders: { // You can still nest further statically
      all: ['all'], // -> user:{userId}:orders:all (Fixed schema example)
      byId: [p.number('orderId')], // -> user:{userId}:orders:{orderId} (Fixed schema example)
    }
  }),

  // You can parameterize with multiple placeholders too!
  tenantResource: parameterize(
    [p('tenantId'), p.number('resourceId')], // Requires { tenantId: string, resourceId: number }
    {
      config: ['config'], // -> tenantResource:{tenantId}:{resourceId}:config (Fixed schema example)
      status: ['status'], // -> tenantResource:{tenantId}:{resourceId}:status (Fixed schema example)
    }
  ),

  // A regular key for comparison
  globalConfig: ['global', 'config'],
});

// --- Usage ---

// 1. Call the parameterized function first to get the access object for that user
const userAccess = keys.user({ userId: 'u-abc' });

// 2. Now use the returned object like normal
const profileKey = userAccess.profile(); // -> "user:u-abc:profile"
const settingsKey = userAccess.settings(); // -> "user:u-abc:settings"
const orderKey = userAccess.orders.byId({ orderId: 99 }); // -> "user:u-abc:orders:99"

// Multi-parameter example
const tenantAccess = keys.tenantResource({ tenantId: 'acme', resourceId: 123 });
const configKey = tenantAccess.config(); // -> "tenantResource:acme:123:config"

// Trying to access before parameterizing? TS Error!
// const badAccess = keys.user.profile(); // TS Error! 'profile' doesn't exist directly on keys.user
```

`parameterize` returns a function. You call that function with the required path parameters, and *it* returns the object containing the next level of key builders, now correctly prefixed! Pretty neat, huh? 🤔

# Custom Separator

Don't like `:`? No problem!

```ts
const keyBuilder = createKeyBuilder({ separator: '::' });

const keys = keyBuilder({
  user: ['user', p('id')]
});

const key = keys.user({ id: '123' }); // -> user::123
```

# API Reference

- `createKeyBuilder(options?: { separator?: string }): (schema) => KeyBuilderResult`
	- Creates the builder factory. Call the returned function with your schema object.
- `p<const Name extends string>(name: Name): Placeholder<string, Name>`
	- Creates a string placeholder, inferring the literal name.
- `p.number<const Name extends string>(name: Name): Placeholder<number, Name>`
	- Creates a number placeholder.
- `p.boolean<const Name extends string>(name: Name): Placeholder<boolean, Name>`
	- Creates a boolean placeholder.
- `parameterize<const P, const S>(placeholders: P, nestedSchema: S): Parameterized<P, S>`
	- Defines a schema level that requires runtime parameters (placeholders) to access the nestedSchema. placeholders can be a single p() result or a readonly array/tuple of them.

# Contributing

Found a bug? Have an idea? Feel free to open an issue or submit a PR!

# License
MIT License. Use it, love it, break it, fix it. ❤️