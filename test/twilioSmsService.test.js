const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/services/twilioSmsService');
const configPath = require.resolve('../src/config/env');
const twilioModulePath = require.resolve('twilio');

function installStub(modulePath, exports) {
  const original = require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
  return () => {
    if (original) {
      require.cache[modulePath] = original;
    } else {
      delete require.cache[modulePath];
    }
  };
}

function loadService(stubs) {
  const restores = [
    installStub(configPath, stubs.config),
    installStub(twilioModulePath, stubs.twilioModule),
  ];
  delete require.cache[servicePath];
  const service = require(servicePath);
  return {
    service,
    restore() {
      delete require.cache[servicePath];
      while (restores.length > 0) {
        const restore = restores.pop();
        restore();
      }
    },
  };
}

function buildConfig() {
  return {
    twilio: {
      accountSid: 'AC123',
      authToken: 'auth-token',
      phoneNumber: '+15105550100',
      requestTimeoutMs: 50,
    },
  };
}

test('sendSms times out when the Twilio messages API hangs', async () => {
  const { service, restore } = loadService({
    config: buildConfig(),
    twilioModule: () => ({
      messages: {
        create: () => new Promise(() => {}),
      },
    }),
  });

  try {
    await assert.rejects(
      service.sendSms({ to: '+15105550123', body: 'hello', timeoutMs: 25 }),
      (error) => error.code === 'ETIMEDOUT' && error.status === 504
    );
  } finally {
    restore();
  }
});

test('fetchTwilioAccountDetails times out when the account lookup hangs', async () => {
  const { service, restore } = loadService({
    config: buildConfig(),
    twilioModule: () => ({
      api: {
        v2010: {
          accounts() {
            return {
              fetch: () => new Promise(() => {}),
            };
          },
        },
      },
      messages: {
        create: async () => ({ sid: 'unused' }),
      },
    }),
  });

  try {
    await assert.rejects(
      service.fetchTwilioAccountDetails(),
      (error) => error.code === 'ETIMEDOUT' && error.status === 504
    );
  } finally {
    restore();
  }
});
