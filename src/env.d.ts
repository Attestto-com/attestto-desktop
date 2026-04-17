/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, any>
  export default component
}

declare module '@attestto/verify' {
  export function verifyPdf(file: File): Promise<{
    signatures: PdfSignatureInfo[]
    hash: string
  }>
  export interface PdfSignatureInfo {
    signerName: string
    issuerName: string
    signedAt: string | null
    certValid: boolean
    integrityValid: boolean
    revocationStatus: string
    pkcs7Hex?: string
  }
}
