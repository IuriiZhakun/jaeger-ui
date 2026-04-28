// Copyright (c) 2026 The Jaeger Authors.
// SPDX-License-Identifier: Apache-2.0

import { IOtelSpan, SpanKind, StatusCode } from '../types/otel';
import { SchemaValuesConfig } from '../types/config';
import { materializeSchemaValuesPayloads } from './schema-values';

const schemaValuesConfig: SchemaValuesConfig = {
  enabled: true,
  registries: [
    {
      schemaId: 'demo.trading.v1',
      messages: {
        '1': { displayName: 'Demo Hello World', typeId: 'demo.hello_world.v1' },
        '2': {
          argTypeIds: ['demo.trade_accepted.v1', 'demo.order_created.v1'],
          displayName: 'Demo Trade Order Message',
          template: 'for trade {} order {}',
        },
      },
      types: {
        'demo.hello_world.v1': {
          displayName: 'Demo Hello World',
          fields: [
            { name: 'message', type: 'string' },
            { name: 'sequence', type: 'integer' },
            { name: 'truncation', type: 'object', typeId: 'demo.truncation.v1', optional: true },
          ],
        },
        'demo.truncation.v1': {
          displayName: 'Demo Truncation',
          fields: [
            { name: 'truncated', type: 'boolean' },
            { name: 'omitted', type: 'string' },
          ],
        },
        'demo.trade_accepted.v1': {
          displayName: 'Demo Trade Accepted',
          fields: [
            { name: 'tradeId', type: 'string' },
            { name: 'symbol', type: 'string' },
            { name: 'side', type: 'string' },
            { name: 'quantity', type: 'integer' },
            { name: 'price', type: 'number' },
          ],
        },
        'demo.address.v1': {
          displayName: 'Demo Address',
          fields: [
            { name: 'street', type: 'string' },
            { name: 'city', type: 'string' },
            { name: 'country', type: 'string' },
            { name: 'postalCode', type: 'string' },
          ],
        },
        'demo.customer.v1': {
          displayName: 'Demo Customer',
          fields: [
            { name: 'customerId', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'address', type: 'object', typeId: 'demo.address.v1' },
          ],
        },
        'demo.order_item.v1': {
          displayName: 'Demo Order Item',
          fields: [
            { name: 'sku', type: 'string' },
            { name: 'quantity', type: 'integer' },
            { name: 'unitPrice', type: 'number' },
          ],
        },
        'demo.order_created.v1': {
          displayName: 'Demo Order Created',
          fields: [
            { name: 'orderId', type: 'string' },
            { name: 'customer', type: 'object', typeId: 'demo.customer.v1' },
            { name: 'items', type: 'rows', rowType: 'demo.order_item.v1' },
            { name: 'expedited', type: 'boolean' },
          ],
        },
      },
    },
  ],
};

function makeSpan(attributes = [{ key: 'sv', value: '[1,"registry hello",7,[false,""]]' }]): IOtelSpan {
  return {
    attributes,
    childSpans: [],
    depth: 0,
    duration: 10 as IOtelSpan['duration'],
    endTime: 20 as IOtelSpan['endTime'],
    events: [],
    hasChildren: false,
    inboundLinks: [],
    instrumentationScope: { name: 'test' },
    kind: SpanKind.INTERNAL,
    links: [],
    name: 'hello_world',
    relativeStartTime: 0 as IOtelSpan['relativeStartTime'],
    resource: { attributes: [], serviceName: 'rust-otel-hello' },
    spanID: 'span-1',
    startTime: 10 as IOtelSpan['startTime'],
    status: { code: StatusCode.OK },
    traceID: 'trace-1',
    warnings: null,
  };
}

describe('materializeSchemaValuesPayloads', () => {
  it('decodes registry messageTypeId carrier with no per-event schema metadata', () => {
    const results = materializeSchemaValuesPayloads(makeSpan(), schemaValuesConfig);

    expect(results).toEqual([
      {
        decoded: {
          message: 'registry hello',
          sequence: 7,
          truncation: { omitted: '', truncated: false },
        },
        displayName: 'Demo Hello World',
        messageTypeId: '1',
        schemaId: 'demo.trading.v1',
        source: 'span attributes',
        status: 'decoded',
        typeId: 'demo.hello_world.v1',
      },
    ]);
  });

  it('decodes nested registry messages with multiple typed arguments', () => {
    const span = makeSpan([
      {
        key: 'sv',
        value:
          '[2,["TRADE-20260427-0001","UST-10Y","BUY",10,99.875],' +
          '["ORDER-20260427-0001",["CUSTOMER-42","Ada Lovelace",' +
          '["1 Algorithm Ave","London","UK","N1 1AA"]],' +
          '[["SKU-OTEL-001",2,19.95],["SKU-JAEGER-002",1,7.5]],true]]',
      },
    ]);

    const results = materializeSchemaValuesPayloads(span, schemaValuesConfig);

    expect(results).toEqual([
      {
        decoded: {
          args: [
            {
              displayName: 'Demo Trade Accepted',
              typeId: 'demo.trade_accepted.v1',
              value: {
                price: 99.875,
                quantity: 10,
                side: 'BUY',
                symbol: 'UST-10Y',
                tradeId: 'TRADE-20260427-0001',
              },
            },
            {
              displayName: 'Demo Order Created',
              typeId: 'demo.order_created.v1',
              value: {
                customer: {
                  address: {
                    city: 'London',
                    country: 'UK',
                    postalCode: 'N1 1AA',
                    street: '1 Algorithm Ave',
                  },
                  customerId: 'CUSTOMER-42',
                  name: 'Ada Lovelace',
                },
                expedited: true,
                items: [
                  { quantity: 2, sku: 'SKU-OTEL-001', unitPrice: 19.95 },
                  { quantity: 1, sku: 'SKU-JAEGER-002', unitPrice: 7.5 },
                ],
                orderId: 'ORDER-20260427-0001',
              },
            },
          ],
          template: 'for trade {} order {}',
        },
        displayName: 'Demo Trade Order Message',
        messageTypeId: '2',
        schemaId: 'demo.trading.v1',
        source: 'span attributes',
        status: 'decoded',
      },
    ]);
  });

  it('extracts registry carriers from span event attributes', () => {
    const span = makeSpan([]);
    span.events = [
      {
        attributes: [{ key: 'sv', value: '[1,"event hello",2]' }],
        name: 'schema-values',
        timestamp: 10 as IOtelSpan['startTime'],
      },
    ];

    const results = materializeSchemaValuesPayloads(span, schemaValuesConfig);

    expect(results).toEqual([
      {
        decoded: { message: 'event hello', sequence: 2, truncation: null },
        displayName: 'Demo Hello World',
        messageTypeId: '1',
        schemaId: 'demo.trading.v1',
        source: 'schema-values attributes #1',
        status: 'decoded',
        typeId: 'demo.hello_world.v1',
      },
    ]);
  });

  it('returns no payloads when schema-values config is disabled', () => {
    expect(materializeSchemaValuesPayloads(makeSpan(), { ...schemaValuesConfig, enabled: false })).toEqual(
      []
    );
  });

  it('returns an explicit error for malformed registry carrier JSON', () => {
    const results = materializeSchemaValuesPayloads(
      makeSpan([{ key: 'sv', value: '[' }]),
      schemaValuesConfig
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      errorCode: 'malformed_registry_message_json',
      source: 'span attributes',
      status: 'error',
    });
  });

  it('returns an explicit error for unknown messageTypeId values', () => {
    const results = materializeSchemaValuesPayloads(
      makeSpan([{ key: 'sv', value: '[999,"hello"]' }]),
      schemaValuesConfig
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      errorCode: 'unknown_message_type_id',
      messageTypeId: '999',
      source: 'span attributes',
      status: 'error',
    });
  });

  it('rejects ambiguous messageTypeId definitions across configured registries', () => {
    const results = materializeSchemaValuesPayloads(makeSpan(), {
      enabled: true,
      registries: [
        ...schemaValuesConfig.registries!,
        {
          schemaId: 'another.v1',
          messages: { '1': { typeId: 'another.hello.v1' } },
          types: { 'another.hello.v1': { fields: [{ name: 'message', type: 'string' }] } },
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ errorCode: 'ambiguous_message_type_id', status: 'error' });
  });

  it('rejects message definitions that define both typeId and argTypeIds', () => {
    const results = materializeSchemaValuesPayloads(makeSpan(), {
      enabled: true,
      registries: [
        {
          ...schemaValuesConfig.registries![0],
          messages: {
            '1': { argTypeIds: ['demo.hello_world.v1'], typeId: 'demo.hello_world.v1' },
          },
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ errorCode: 'invalid_message_definition', status: 'error' });
  });

  it('rejects payloads with more positional values than the configured type fields', () => {
    const results = materializeSchemaValuesPayloads(
      makeSpan([{ key: 'sv', value: '[1,"registry hello",7,[false,""],"extra"]' }]),
      schemaValuesConfig
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ errorCode: 'extra_values', status: 'error' });
  });
});
