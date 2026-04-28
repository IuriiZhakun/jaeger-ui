// Copyright (c) 2026 The Jaeger Authors.
// SPDX-License-Identifier: Apache-2.0

import { IOtelSpan, SpanKind, StatusCode } from '../types/otel';
import { SchemaValuesConfig } from '../types/config';
import { materializeSchemaValuesPayloads } from './schema-values';

const schemaValuesConfig: SchemaValuesConfig = {
  enabled: true,
  registries: [
    {
      schemaId: 'demo.hello.v1',
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
            { name: 'attributes', type: 'kv_pairs', duplicateKeyPolicy: 'preserve_array' },
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

function makeSpan(valuesJson: string, schemaId = 'demo.hello.v1'): IOtelSpan {
  return {
    attributes: [
      { key: 'payload.schema_id', value: schemaId },
      { key: 'payload.type_id', value: 'demo.hello_world.v1' },
      { key: 'payload.encoding', value: 'schema_values_json' },
      { key: 'payload.values_json', value: valuesJson },
    ],
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
  it('decodes configured schema-values span attributes into a named message object', () => {
    const results = materializeSchemaValuesPayloads(
      makeSpan('["hello from Rust OpenTelemetry demo",7,[["route","demo"],["route","fork"]],[false,""]]'),
      schemaValuesConfig
    );

    expect(results).toEqual([
      {
        decoded: {
          attributes: { route: ['demo', 'fork'] },
          message: 'hello from Rust OpenTelemetry demo',
          sequence: 7,
          truncation: { omitted: '', truncated: false },
        },
        displayName: 'Demo Hello World',
        encoding: 'schema_values_json',
        schemaId: 'demo.hello.v1',
        source: 'span attributes',
        status: 'decoded',
        typeId: 'demo.hello_world.v1',
      },
    ]);
  });

  it('returns a materialization error for unknown schema ids instead of guessing field names', () => {
    const results = materializeSchemaValuesPayloads(
      makeSpan('["hello",1,[],null]', 'unknown.v1'),
      schemaValuesConfig
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ errorCode: 'unknown_schema_id', status: 'error' });
  });

  it('decodes registry messageTypeId carrier with no per-event schema metadata', () => {
    const span = makeSpan('[]');
    span.attributes = [{ key: 'sv', value: '[1,"registry hello",7,[],[false,""]]' }];

    const results = materializeSchemaValuesPayloads(span, schemaValuesConfig);

    expect(results).toEqual([
      {
        decoded: {
          attributes: {},
          message: 'registry hello',
          sequence: 7,
          truncation: { omitted: '', truncated: false },
        },
        displayName: 'Demo Hello World',
        messageTypeId: '1',
        schemaId: 'demo.hello.v1',
        source: 'span attributes',
        status: 'decoded',
        typeId: 'demo.hello_world.v1',
      },
    ]);
  });

  it('decodes registry messageTypeId carrier with multiple typed arguments', () => {
    const span = makeSpan('[]');
    span.attributes = [
      {
        key: 'sv',
        value:
          '[2,["TRADE-20260427-0001","UST-10Y","BUY",10,99.875],' +
          '["ORDER-20260427-0001",["CUSTOMER-42","Ada Lovelace",' +
          '["1 Algorithm Ave","London","UK","N1 1AA"]],' +
          '[["SKU-OTEL-001",2,19.95],["SKU-JAEGER-002",1,7.5]],true]]',
      },
    ];

    const results = materializeSchemaValuesPayloads(span, schemaValuesConfig);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      displayName: 'Demo Trade Order Message',
      messageTypeId: '2',
      schemaId: 'demo.hello.v1',
      status: 'decoded',
    });
    expect(results[0].status === 'decoded' ? results[0].decoded : {}).toMatchObject({
      args: [
        {
          displayName: 'Demo Trade Accepted',
          typeId: 'demo.trade_accepted.v1',
          value: { tradeId: 'TRADE-20260427-0001' },
        },
        {
          displayName: 'Demo Order Created',
          typeId: 'demo.order_created.v1',
          value: { orderId: 'ORDER-20260427-0001' },
        },
      ],
      template: 'for trade {} order {}',
    });
  });

  it('extracts complete schema-values envelopes from event attributes', () => {
    const span = makeSpan('[]');
    span.attributes = [];
    span.events = [
      {
        attributes: [
          { key: 'payload.schema_id', value: 'demo.hello.v1' },
          { key: 'payload.type_id', value: 'demo.hello_world.v1' },
          { key: 'payload.encoding', value: 'schema_values_json' },
          { key: 'payload.values_json', value: '["event hello",2,[]]' },
        ],
        name: 'schema-values',
        timestamp: 10 as IOtelSpan['startTime'],
      },
    ];

    const results = materializeSchemaValuesPayloads(span, schemaValuesConfig);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      decoded: { attributes: {}, message: 'event hello', sequence: 2, truncation: null },
      source: 'schema-values attributes #1',
      status: 'decoded',
    });
  });
});
