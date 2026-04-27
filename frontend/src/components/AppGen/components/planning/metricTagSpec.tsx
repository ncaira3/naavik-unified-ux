import { createReactInlineContentSpec } from '@blocknote/react'
import { MetricTagPill } from './MetricTagPill'

export const MetricTag = createReactInlineContentSpec(
  {
    type: 'metricTag' as const,
    propSchema: {
      metricType: { default: 'PM' },
      ioc: { default: '' },
      metric: { default: '' },
    },
    content: 'none' as const,
  },
  {
    render: (props) => (
      <MetricTagPill
        metricType={props.inlineContent.props.metricType}
        ioc={props.inlineContent.props.ioc}
        metric={props.inlineContent.props.metric}
        updateInlineContent={props.updateInlineContent as any}
      />
    ),
  },
)
