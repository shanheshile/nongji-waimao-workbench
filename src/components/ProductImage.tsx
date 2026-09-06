import { useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { buildLocalImageCandidates, localImageCandidateAt } from '../lib/product-media.js'

interface ProductImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  primarySource: string
  fallbackSources?: string[]
  fallbackLabel?: string
}

export function ProductImage({
  primarySource,
  fallbackSources = [],
  fallbackLabel = '暂无可用演示图',
  alt,
  className = '',
  ...imageProps
}: ProductImageProps) {
  const candidates = buildLocalImageCandidates(primarySource, fallbackSources)
  const signature = candidates.join('|')
  const [attempt, setAttempt] = useState({ signature, index: 0 })
  const index = attempt.signature === signature ? attempt.index : 0
  const source = localImageCandidateAt(candidates, index)
  const mediaClassName = `product-image-media ${className}`.trim()

  if (!source) {
    return (
      <span
        className={`${mediaClassName} product-image-placeholder`}
        role="img"
        aria-label={alt ? `${alt}；${fallbackLabel}` : fallbackLabel}
      >
        <span aria-hidden="true">图片待补</span>
        <small aria-hidden="true">{fallbackLabel}</small>
      </span>
    )
  }

  return (
    <img
      {...imageProps}
      className={mediaClassName}
      src={source}
      alt={alt}
      onError={() => {
        setAttempt((current) => ({
          signature,
          index: current.signature === signature ? current.index + 1 : 1,
        }))
      }}
    />
  )
}
