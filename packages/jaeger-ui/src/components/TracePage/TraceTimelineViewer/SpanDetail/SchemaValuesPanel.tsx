// Copyright (c) 2026 The Jaeger Authors.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Alert } from 'antd';
import { JsonView, allExpanded, defaultStyles } from 'react-json-view-lite';

import getConfig from '../../../../utils/config/get-config';
import { materializeSchemaValuesPayloads, TSchemaValuesPayload } from '../../../../model/schema-values';
import { IOtelSpan } from '../../../../types/otel';
import { SchemaValuesConfig } from '../../../../types/config';

import './SchemaValuesPanel.css';

type SchemaValuesPanelProps = {
  schemaValuesConfig?: SchemaValuesConfig;
  span: IOtelSpan;
};

function MaterializedPayload({ payload }: { payload: Extract<TSchemaValuesPayload, { status: 'decoded' }> }) {
  return (
    <section className="SchemaValuesPanel--item" data-testid="schema-values-materialized-message">
      <div className="SchemaValuesPanel--itemHeader">
        <strong>{payload.displayName}</strong>
        <span className="SchemaValuesPanel--source">{payload.source}</span>
      </div>
      <dl className="SchemaValuesPanel--metadata">
        <dt>Schema ID</dt>
        <dd>{payload.schemaId}</dd>
        {payload.messageTypeId && (
          <>
            <dt>Message Type ID</dt>
            <dd>{payload.messageTypeId}</dd>
          </>
        )}
        {payload.typeId && (
          <>
            <dt>Type ID</dt>
            <dd>{payload.typeId}</dd>
          </>
        )}
        {payload.encoding && (
          <>
            <dt>Encoding</dt>
            <dd>{payload.encoding}</dd>
          </>
        )}
      </dl>
      <JsonView
        data={payload.decoded}
        shouldExpandNode={allExpanded}
        style={{
          ...defaultStyles,
          container: 'json-markup SchemaValuesPanel--json',
          label: 'json-markup-key',
          stringValue: 'json-markup-string',
          collapseIcon: 'json-markup-icon-collapse',
          collapsedContent: 'json-markup-collapse-content',
          expandIcon: 'json-markup-icon-expand',
          numberValue: 'json-markup-number',
          booleanValue: 'json-markup-bool',
          nullValue: 'json-markup-null',
          undefinedValue: 'json-markup-undefined',
          basicChildStyle: 'json-markup-child',
          punctuation: 'json-markup-puncuation',
          otherValue: 'json-markup-other',
        }}
      />
    </section>
  );
}

function PayloadError({ payload }: { payload: Extract<TSchemaValuesPayload, { status: 'error' }> }) {
  const context = [payload.schemaId, payload.typeId, payload.source].filter(Boolean).join(' · ');
  return (
    <Alert
      className="SchemaValuesPanel--error"
      data-testid="schema-values-error"
      description={payload.errorMessage}
      message={`Schema-values materialization failed: ${payload.errorCode}${context ? ` (${context})` : ''}`}
      showIcon
      type="warning"
    />
  );
}

export default function SchemaValuesPanel({ schemaValuesConfig, span }: SchemaValuesPanelProps) {
  const config = schemaValuesConfig ?? getConfig().schemaValues;
  const payloads = React.useMemo(() => materializeSchemaValuesPayloads(span, config), [config, span]);

  if (payloads.length === 0) {
    return null;
  }

  return (
    <section className="SchemaValuesPanel" data-testid="schema-values-panel">
      <h3 className="SchemaValuesPanel--title">Schema Values</h3>
      {payloads.map((payload, index) =>
        payload.status === 'decoded' ? (
          <MaterializedPayload
            key={`${payload.source}-${payload.schemaId}-${payload.typeId ?? payload.messageTypeId}-${index}`}
            payload={payload}
          />
        ) : (
          <PayloadError key={`${payload.source}-${payload.errorCode}-${index}`} payload={payload} />
        )
      )}
    </section>
  );
}
