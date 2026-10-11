import { expect } from 'chai';
import { loadRegisters } from '../registers/plant';
import type { RegisterEntry } from '../registers/types';
import { circuitTags, modbusTagRegisters } from './tags';

describe('IDM tags', () => {
    it('names the circuit sensors B51-B57 and B61-B67 and knows their registers', () => {
        expect(circuitTags('A')).to.deep.equal({ flow: 'B51', room: 'B61' });
        expect(circuitTags('D')).to.deep.equal({ flow: 'B54', room: 'B64' }); // verified live at a Navigator 10 by Xerolux
        expect(circuitTags('G')).to.deep.equal({ flow: 'B57', room: 'B67' });
        expect(circuitTags('H')).to.equal(null);
        const registers = modbusTagRegisters(loadRegisters('nav20') as RegisterEntry[]);
        expect(registers.get('B52')).to.equal('hc_b_flow_temp');
        expect(registers.get('B33')).to.equal('hp_flow_temp');
    });
});
