import { expect } from 'chai';
import { mapLibraryError } from './client';

/**
 * Create an error with the class name modbus-connect uses, carrying a host in its message like the real ones do.
 *
 * @param name the library's error class name
 * @param extra additional properties such as exceptionCode
 */
function libraryError(name: string, extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error('Socket error: connect ECONNREFUSED 10.9.9.9:502'), { name, ...extra });
}

describe('mapLibraryError', () => {
    it('maps exceptions with their code', () => {
        expect(mapLibraryError(libraryError('ModbusExceptionError', { exceptionCode: 2 }))).to.deep.equal({
            ok: false,
            error: { kind: 'exception', message: 'Modbus exception 2', exceptionCode: 2 },
        });
        expect(mapLibraryError(libraryError('ModbusIllegalDataAddressError'))).to.deep.include({ ok: false });
        expect(mapLibraryError(libraryError('ModbusSlaveBusyError'))).to.have.nested.property('error.exceptionCode', 6);
    });
    it('maps timeouts, lost connections and everything else', () => {
        expect(mapLibraryError(libraryError('ModbusTimeoutError'))).to.have.nested.property('error.kind', 'timeout');
        expect(mapLibraryError(libraryError('ModbusOperationTimeoutError'))).to.have.nested.property(
            'error.kind',
            'timeout',
        );
        expect(mapLibraryError(libraryError('NodeTcpWriteError'))).to.have.nested.property('error.kind', 'offline');
        expect(mapLibraryError(libraryError('PortNotOpenError'))).to.have.nested.property('error.kind', 'offline');
        expect(mapLibraryError(libraryError('ModbusCRCError'))).to.have.nested.property('error.kind', 'protocol');
        expect(mapLibraryError('boom')).to.have.nested.property('error.kind', 'protocol');
    });
    it('never passes the library message on (it can contain the host)', () => {
        for (const name of ['ModbusTimeoutError', 'NodeTcpWriteError', 'ModbusCRCError', 'Whatever']) {
            expect(JSON.stringify(mapLibraryError(libraryError(name)))).to.not.contain('10.9.9.9');
        }
    });
});
