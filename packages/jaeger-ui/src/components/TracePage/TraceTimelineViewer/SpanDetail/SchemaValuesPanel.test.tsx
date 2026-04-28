// Copyright (c) 2026 The Jaeger Authors.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import SchemaValuesPanel from './SchemaValuesPanel';
import { IOtelSpan, SpanKind, StatusCode } from '../../../../types/otel';
import { SchemaValuesConfig } from '../../../../types/config';

const schemaValuesConfig: SchemaValuesConfig = {
  enabled: true,
  registries: [
    {
      schemaId: 'demo.hello.v1',
      messages: {
        '1': { displayName: 'Demo Hello World', typeId: 'demo.hello_world.v1' },
      },
      types: {
        'demo.hello_world.v1': {
          displayName: 'Demo Hello World',
          fields: [
            { name: 'message', type: 'string' },
            { name: 'serviceName', type: 'string' },
          ],
        },
      },
    },
  ],
};

const span: IOtelSpan = {
  attributes: [{ key: 'sv', value: '[1,"hello from Rust OpenTelemetry demo","rust-otel-hello"]' }],
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

describe('<SchemaValuesPanel>', () => {
  it('renders a fully materialized schema-values message from span attributes', () => {
    render(<SchemaValuesPanel schemaValuesConfig={schemaValuesConfig} span={span} />);

    expect(screen.getByTestId('schema-values-panel')).toBeInTheDocument();
    expect(screen.getByText('Demo Hello World')).toBeInTheDocument();
    expect(screen.getByText('demo.hello.v1')).toBeInTheDocument();
    expect(screen.getByText('demo.hello_world.v1')).toBeInTheDocument();
    const materializedMessage = screen.getByTestId('schema-values-materialized-message');
    expect(materializedMessage).toHaveTextContent('message');
    expect(materializedMessage).toHaveTextContent('hello from Rust OpenTelemetry demo');
    expect(materializedMessage).toHaveTextContent('serviceName');
    expect(materializedMessage).toHaveTextContent('rust-otel-hello');
  });

  it('renders registry message type id metadata without legacy encoding metadata', () => {
    render(
      <SchemaValuesPanel
        schemaValuesConfig={schemaValuesConfig}
        span={{
          ...span,
          attributes: [{ key: 'sv', value: '[1,"hello from registry","rust-otel-hello"]' }],
        }}
      />
    );

    expect(screen.getByTestId('schema-values-panel')).toBeInTheDocument();
    expect(screen.getByText('Demo Hello World')).toBeInTheDocument();
    expect(screen.getByText('Message Type ID')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Encoding')).not.toBeInTheDocument();
    expect(screen.getByTestId('schema-values-materialized-message')).toHaveTextContent('hello from registry');
  });

  it('renders an explicit warning when a payload cannot be decoded', () => {
    render(<SchemaValuesPanel schemaValuesConfig={{ enabled: true, registries: [] }} span={span} />);

    expect(screen.getByTestId('schema-values-error')).toBeInTheDocument();
    expect(screen.getByText(/unknown_message_type_id/)).toBeInTheDocument();
  });
});
