import { it } from 'vitest'
import fixtures from './__fixtures__/timetable-divA.json'
import { stitchCellFrags } from './timetableImport'
import type { Frag } from './timetableImport'

it('diag', () => {
  const box: Frag[] = [
    // y=353 header row (Monday slice)
    { x: 181, end: 216, y: 353.0, str: 'Monday', page: 0 },
    // y=334.5 A1 FE (P) PS 2408
    { x: 156, end: 166, y: 334.5, str: 'A1', page: 0 },
    { x: 173, end: 187, y: 334.5, str: 'FE', page: 0 },
    { x: 191, end: 204, y: 334.5, str: '(P)', page: 0 },
    { x: 208, end: 218, y: 334.5, str: 'PS', page: 0 },
    { x: 225, end: 243, y: 334.5, str: '2408', page: 0 },
    // y=320.7 time label + A2 WAD (P) YP 2314
    { x: 66, end: 85, y: 320.7, str: '8:00', page: 0 },
    { x: 91, end: 95, y: 320.7, str: '-', page: 0 },
    { x: 98, end: 117, y: 320.7, str: '9:00', page: 0 },
    { x: 148, end: 158, y: 320.7, str: 'A2', page: 0 },
    { x: 166, end: 189, y: 320.7, str: 'WAD', page: 0 },
    { x: 196, end: 209, y: 320.7, str: '(P)', page: 0 },
    { x: 214, end: 225, y: 320.7, str: 'YP', page: 0 },
    { x: 232, end: 250, y: 320.7, str: '2314', page: 0 },
    // y=306.9 A3 CP (P) CK 2416
    { x: 154, end: 164, y: 306.9, str: 'A3', page: 0 },
    { x: 172, end: 183, y: 306.9, str: 'CP', page: 0 },
    { x: 189, end: 202, y: 306.9, str: '(P)', page: 0 },
    { x: 207, end: 218, y: 306.9, str: 'CK', page: 0 },
    { x: 227, end: 245, y: 306.9, str: '2416', page: 0 },
  ]
  console.log('STITCH', JSON.stringify(stitchCellFrags(box)))
})
