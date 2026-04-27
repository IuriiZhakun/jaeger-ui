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
