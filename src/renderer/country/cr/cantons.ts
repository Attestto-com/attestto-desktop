// ── Costa Rica Canton Registry ──
// Maps CODELEC codes to canton names and TSE download URLs.
// Source: https://www.tse.go.cr/descarga_padron.htm
//
// CODELEC format: 6 digits
//   - Digit 1: Province (1-7)
//   - Digits 2-3: Canton (01-20)
//   - Digits 4-6: Distrito electoral
//
// Canton key = first 3 digits of CODELEC (province + canton)

const TSE_BASE = 'https://www.tse.go.cr/zip/padron'

export interface CantonInfo {
  code: string        // 3-digit: province(1) + canton(2)
  name: string
  province: string
  zipFile: string     // filename on TSE server
  /** Approximate number of electors (Feb 2026) */
  electors: number
}

export const CR_PROVINCES: Record<string, string> = {
  '1': 'San Jose',
  '2': 'Alajuela',
  '3': 'Cartago',
  '4': 'Heredia',
  '5': 'Guanacaste',
  '6': 'Puntarenas',
  '7': 'Limon',
}

export const CR_CANTONS: CantonInfo[] = [
  // ── San José ──
  { code: '101', name: 'San Jose Central', province: 'San Jose', zipFile: 'SJCENTRAL.zip', electors: 239295 },
  { code: '102', name: 'Escazu', province: 'San Jose', zipFile: 'sjescazu.zip', electors: 54245 },
  { code: '103', name: 'Desamparados', province: 'San Jose', zipFile: 'SJDESAMPARADOS.zip', electors: 169438 },
  { code: '104', name: 'Puriscal', province: 'San Jose', zipFile: 'SJPURISCAL.zip', electors: 30904 },
  { code: '105', name: 'Tarrazu', province: 'San Jose', zipFile: 'SJTARRAZU.zip', electors: 13202 },
  { code: '106', name: 'Aserri', province: 'San Jose', zipFile: 'SJASERRI.zip', electors: 46596 },
  { code: '107', name: 'Mora', province: 'San Jose', zipFile: 'SJMORA.zip', electors: 25162 },
  { code: '108', name: 'Goicoechea', province: 'San Jose', zipFile: 'SJGOICOECHEA.zip', electors: 93482 },
  { code: '109', name: 'Santa Ana', province: 'San Jose', zipFile: 'SJSANTAANA.zip', electors: 43521 },
  { code: '110', name: 'Alajuelita', province: 'San Jose', zipFile: 'SJALAJUELITA.zip', electors: 55451 },
  { code: '111', name: 'Vazquez de Coronado', province: 'San Jose', zipFile: 'SJVAZQUEZDECORONADO.zip', electors: 58051 },
  { code: '112', name: 'Acosta', province: 'San Jose', zipFile: 'SJACOSTA.zip', electors: 18380 },
  { code: '113', name: 'Tibas', province: 'San Jose', zipFile: 'SJTIBAS.zip', electors: 56900 },
  { code: '114', name: 'Moravia', province: 'San Jose', zipFile: 'SJMORAVIA.zip', electors: 46760 },
  { code: '115', name: 'Montes de Oca', province: 'San Jose', zipFile: 'SJMONTESDEOCA.zip', electors: 43882 },
  { code: '116', name: 'Turrubares', province: 'San Jose', zipFile: 'SJTURRUBARES.zip', electors: 5250 },
  { code: '117', name: 'Dota', province: 'San Jose', zipFile: 'SJDOTA.zip', electors: 6282 },
  { code: '118', name: 'Curridabat', province: 'San Jose', zipFile: 'SJCURRIDABAT.zip', electors: 54390 },
  { code: '119', name: 'Perez Zeledon', province: 'San Jose', zipFile: 'SJPEREZZELEDON.zip', electors: 123683 },
  { code: '120', name: 'Leon Cortes Castro', province: 'San Jose', zipFile: 'SJLEONCORTESCASTRO.zip', electors: 9707 },

  // ── Alajuela ──
  { code: '201', name: 'Alajuela Central', province: 'Alajuela', zipFile: 'ALCENTRAL.zip', electors: 230848 },
  { code: '202', name: 'San Ramon', province: 'Alajuela', zipFile: 'ALSANRAMON.zip', electors: 72795 },
  { code: '203', name: 'Grecia', province: 'Alajuela', zipFile: 'ALGRECIA.zip', electors: 60846 },
  { code: '204', name: 'San Mateo', province: 'Alajuela', zipFile: 'ALSANMATEO.zip', electors: 5384 },
  { code: '205', name: 'Atenas', province: 'Alajuela', zipFile: 'ALATENAS.zip', electors: 23492 },
  { code: '206', name: 'Naranjo', province: 'Alajuela', zipFile: 'ALNARANJO.zip', electors: 34925 },
  { code: '207', name: 'Palmares', province: 'Alajuela', zipFile: 'ALPALMARES.zip', electors: 30981 },
  { code: '208', name: 'Poas', province: 'Alajuela', zipFile: 'ALPOAS.zip', electors: 25203 },
  { code: '209', name: 'Orotina', province: 'Alajuela', zipFile: 'ALOROTINA.zip', electors: 17966 },
  { code: '210', name: 'San Carlos', province: 'Alajuela', zipFile: 'ALSANCARLOS.zip', electors: 129353 },
  { code: '211', name: 'Zarcero', province: 'Alajuela', zipFile: 'ALZARCERO.zip', electors: 9713 },
  { code: '212', name: 'Sarchi', province: 'Alajuela', zipFile: 'ALSARCHI.zip', electors: 16122 },
  { code: '213', name: 'Upala', province: 'Alajuela', zipFile: 'ALUPALA.zip', electors: 34753 },
  { code: '214', name: 'Los Chiles', province: 'Alajuela', zipFile: 'ALLOSCHILES.zip', electors: 15323 },
  { code: '215', name: 'Guatuso', province: 'Alajuela', zipFile: 'ALGUATUSO.zip', electors: 12695 },
  { code: '216', name: 'Rio Cuarto', province: 'Alajuela', zipFile: 'ALRIOCUARTO.zip', electors: 7544 },

  // ── Cartago ──
  { code: '301', name: 'Cartago Central', province: 'Cartago', zipFile: 'CACENTRAL.zip', electors: 134487 },
  { code: '302', name: 'Paraiso', province: 'Cartago', zipFile: 'CAPARAISO.zip', electors: 51891 },
  { code: '303', name: 'La Union', province: 'Cartago', zipFile: 'CALAUNION.zip', electors: 78321 },
  { code: '304', name: 'Jimenez', province: 'Cartago', zipFile: 'CAJIMENEZ.zip', electors: 13378 },
  { code: '305', name: 'Turrialba', province: 'Cartago', zipFile: 'CATURRIALBA.zip', electors: 61669 },
  { code: '306', name: 'Alvarado', province: 'Cartago', zipFile: 'CAALVARADO.zip', electors: 12186 },
  { code: '307', name: 'Oreamuno', province: 'Cartago', zipFile: 'CAOREAMUNO.zip', electors: 39850 },
  { code: '308', name: 'El Guarco', province: 'Cartago', zipFile: 'CAELGUARCO.zip', electors: 38416 },

  // ── Heredia ──
  { code: '401', name: 'Heredia Central', province: 'Heredia', zipFile: 'HECENTRAL.zip', electors: 106894 },
  { code: '402', name: 'Barva', province: 'Heredia', zipFile: 'HEBARVA.zip', electors: 37011 },
  { code: '403', name: 'Santo Domingo', province: 'Heredia', zipFile: 'HESANTODOMINGO.zip', electors: 38127 },
  { code: '404', name: 'Santa Barbara', province: 'Heredia', zipFile: 'HESANTABARBARA.zip', electors: 30668 },
  { code: '405', name: 'San Rafael', province: 'Heredia', zipFile: 'HESANRAFAEL.zip', electors: 41533 },
  { code: '406', name: 'San Isidro', province: 'Heredia', zipFile: 'HESANISIDRO.zip', electors: 18593 },
  { code: '407', name: 'Belen', province: 'Heredia', zipFile: 'HEBELEN.zip', electors: 21083 },
  { code: '408', name: 'Flores', province: 'Heredia', zipFile: 'HEFLORES.zip', electors: 19501 },
  { code: '409', name: 'San Pablo', province: 'Heredia', zipFile: 'HESANPABLO.zip', electors: 25398 },
  { code: '410', name: 'Sarapiqui', province: 'Heredia', zipFile: 'HESARAPIQUI.zip', electors: 40917 },

  // ── Guanacaste ──
  { code: '501', name: 'Liberia', province: 'Guanacaste', zipFile: 'GULIBERIA.zip', electors: 54210 },
  { code: '502', name: 'Nicoya', province: 'Guanacaste', zipFile: 'GUNICOYA.zip', electors: 46774 },
  { code: '503', name: 'Santa Cruz', province: 'Guanacaste', zipFile: 'GUSANTACRUZ.zip', electors: 49213 },
  { code: '504', name: 'Bagaces', province: 'Guanacaste', zipFile: 'GUBAGACES.zip', electors: 16138 },
  { code: '505', name: 'Carrillo', province: 'Guanacaste', zipFile: 'GUCARRILLO.zip', electors: 29516 },
  { code: '506', name: 'Canas', province: 'Guanacaste', zipFile: 'GUCANAS.zip', electors: 20911 },
  { code: '507', name: 'Abangares', province: 'Guanacaste', zipFile: 'GUABANGARES.zip', electors: 14893 },
  { code: '508', name: 'Tilaran', province: 'Guanacaste', zipFile: 'GUTILARAN.zip', electors: 16769 },
  { code: '509', name: 'Nandayure', province: 'Guanacaste', zipFile: 'GUNANDAYURE.zip', electors: 9182 },
  { code: '510', name: 'La Cruz', province: 'Guanacaste', zipFile: 'GULACRUZ.zip', electors: 16043 },
  { code: '511', name: 'Hojancha', province: 'Guanacaste', zipFile: 'GUHOJANCHA.zip', electors: 6807 },

  // ── Puntarenas ──
  { code: '601', name: 'Puntarenas Central', province: 'Puntarenas', zipFile: 'PUCENTRAL.zip', electors: 90995 },
  { code: '602', name: 'Esparza', province: 'Puntarenas', zipFile: 'PUESPARZA.zip', electors: 25820 },
  { code: '603', name: 'Buenos Aires', province: 'Puntarenas', zipFile: 'PUBUENOSAIRES.zip', electors: 35759 },
  { code: '604', name: 'Montes de Oro', province: 'Puntarenas', zipFile: 'PUMONTESDEORO.zip', electors: 11284 },
  { code: '605', name: 'Osa', province: 'Puntarenas', zipFile: 'PUOSA.zip', electors: 26676 },
  { code: '606', name: 'Quepos', province: 'Puntarenas', zipFile: 'PUQUEPOS.zip', electors: 22848 },
  { code: '607', name: 'Golfito', province: 'Puntarenas', zipFile: 'PUGOLFITO.zip', electors: 25750 },
  { code: '608', name: 'Coto Brus', province: 'Puntarenas', zipFile: 'PUCOTOBRUS.zip', electors: 34610 },
  { code: '609', name: 'Parrita', province: 'Puntarenas', zipFile: 'PUPARRITA.zip', electors: 14224 },
  { code: '610', name: 'Corredores', province: 'Puntarenas', zipFile: 'PUCORREDORES.zip', electors: 37606 },
  { code: '611', name: 'Garabito', province: 'Puntarenas', zipFile: 'PUGARABITO.zip', electors: 15264 },
  { code: '612', name: 'Monteverde', province: 'Puntarenas', zipFile: 'pumonteverde.zip', electors: 4141 },
  { code: '613', name: 'Puerto Jimenez', province: 'Puntarenas', zipFile: 'pupuertojimenez.zip', electors: 7617 },

  // ── Limón ──
  { code: '701', name: 'Limon Central', province: 'Limon', zipFile: 'LICENTRAL.zip', electors: 76749 },
  { code: '702', name: 'Pococi', province: 'Limon', zipFile: 'LIPOCOCI.zip', electors: 105215 },
  { code: '703', name: 'Siquirres', province: 'Limon', zipFile: 'LISIQUIRRES.zip', electors: 44777 },
  { code: '704', name: 'Talamanca', province: 'Limon', zipFile: 'LITALAMANCA.zip', electors: 28389 },
  { code: '705', name: 'Matina', province: 'Limon', zipFile: 'LIMATINA.zip', electors: 25743 },
  { code: '706', name: 'Guacimo', province: 'Limon', zipFile: 'LIGUACIMO.zip', electors: 34265 },
]

/** Get canton info from CODELEC (first 3 digits) */
export function getCantonByCodelec(codelec: string): CantonInfo | undefined {
  const code = codelec.substring(0, 3)
  return CR_CANTONS.find(c => c.code === code)
}

/** Get canton info from cédula first digit (province) — returns all cantons in that province */
export function getCantonsByProvince(provinceDigit: string): CantonInfo[] {
  return CR_CANTONS.filter(c => c.code[0] === provinceDigit)
}

/** Get the TSE download URL for a canton */
export function getCantonDownloadUrl(canton: CantonInfo): string {
  return `${TSE_BASE}/${canton.zipFile}`
}

/** Total: 82 cantons, 3,749,220 electors (Feb 2026) */
export const CR_TOTAL_ELECTORS = 3749220
export const CR_TOTAL_CANTONS = CR_CANTONS.length
