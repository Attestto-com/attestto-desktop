// ── Costa Rica Document Verification Plugins ──
// These populate the "Documentos oficiales" section in IdentityPage
// when the CR identity module is installed.

export interface DocumentPlugin {
  id: string
  label: string
  icon: string
  description: string
  route: string
  /** Campos que el plugin extrae del documento */
  fields: string[]
}

export const crDocumentPlugins: DocumentPlugin[] = [
  {
    id: 'cr-cedula',
    label: 'Cedula de identidad',
    icon: 'badge',
    description: 'Documento emitido por el TSE — escaneo frontal y posterior, validacion con Padron Nacional',
    route: '/verify/cr/cedula',
    fields: ['nombre', 'apellidos', 'cedula', 'fechaNacimiento', 'sexo', 'fechaEmision', 'fechaVencimiento'],
  },
  {
    id: 'cr-dimex',
    label: 'DIMEX',
    icon: 'card_membership',
    description: 'Documento de Identidad Migratoria para Extranjeros — residentes temporales y permanentes',
    route: '/verify/cr/dimex',
    fields: ['nombre', 'apellidos', 'dimex', 'nacionalidad', 'categoriaResidencia', 'fechaVencimiento'],
  },
  {
    id: 'cr-passport',
    label: 'Pasaporte',
    icon: 'flight',
    description: 'Pasaporte costarricense — pagina de datos MRZ',
    route: '/verify/cr/passport',
    fields: ['nombre', 'apellidos', 'pasaporte', 'nacionalidad', 'fechaNacimiento', 'fechaVencimiento', 'mrz'],
  },
]
