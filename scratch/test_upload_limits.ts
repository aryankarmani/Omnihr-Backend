import jwt from 'jsonwebtoken';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3001/api';
const JWT_SECRET = process.env.JWT_SECRET || 'secretkey';

const tokenUserA = jwt.sign(
    { id: 2, email: 'keshavyogi1234@gmail.com', tenantId: 'be5bfd7f-0adf-4ae1-9efe-5af40d589728', role: 'Employee' },
    JWT_SECRET,
    { expiresIn: '1h' }
);

async function runUploadTests() {
    console.log('=== STARTING UPLOAD LIMIT & TYPE TESTS ===\n');

    const tempDir = path.join(__dirname, 'temp_upload_test');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
        // Test 1: 9MB valid PDF file -> ACCEPT
        console.log('Test 1: 9MB valid PDF file...');
        const file9MB = path.join(tempDir, 'test_9mb.pdf');
        fs.writeFileSync(file9MB, Buffer.alloc(9 * 1024 * 1024, '%PDF-1.4 sample data '));
        try {
            const form1 = new FormData();
            form1.append('file', fs.createReadStream(file9MB));
            const res1 = await axios.post(`${API_BASE}/communication/upload`, form1, {
                headers: {
                    ...form1.getHeaders(),
                    Authorization: `Bearer ${tokenUserA}`
                }
            });
            if (res1.status === 200 && res1.data.fileName === 'test_9mb.pdf') {
                console.log(' [PASS] 9MB PDF accepted: 200 OK, size = ' + res1.data.fileSize);
            } else {
                console.log(' [FAIL] 9MB PDF unexpected response: ' + res1.status);
            }
        } catch (e: any) {
            console.log(' [FAIL] 9MB PDF failed: ' + (e.response?.data?.message || e.message));
        }

        // Test 2: 10MB valid PDF file (10,000,000 bytes) -> ACCEPT
        console.log('\nTest 2: 10MB valid PDF file (10,000,000 bytes)...');
        const file10MB = path.join(tempDir, 'test_10mb.pdf');
        fs.writeFileSync(file10MB, Buffer.alloc(10 * 1000 * 1000, '%PDF-1.4 sample data '));
        try {
            const form2 = new FormData();
            form2.append('file', fs.createReadStream(file10MB));
            const res2 = await axios.post(`${API_BASE}/communication/upload`, form2, {
                headers: {
                    ...form2.getHeaders(),
                    Authorization: `Bearer ${tokenUserA}`
                }
            });
            if (res2.status === 200 && res2.data.fileName === 'test_10mb.pdf') {
                console.log(' [PASS] 10MB PDF accepted: 200 OK, size = ' + res2.data.fileSize);
            } else {
                console.log(' [FAIL] 10MB PDF unexpected response: ' + res2.status);
            }
        } catch (e: any) {
            console.log(' [FAIL] 10MB PDF failed: ' + (e.response?.data?.message || e.message));
        }

        // Test 3: 11MB file (> 10MB) -> REJECT
        console.log('\nTest 3: 11MB file (> 10MB limit)...');
        const file11MB = path.join(tempDir, 'test_11mb.pdf');
        fs.writeFileSync(file11MB, Buffer.alloc(11 * 1024 * 1024, '%PDF-1.4 sample data '));
        try {
            const form3 = new FormData();
            form3.append('file', fs.createReadStream(file11MB));
            const res3 = await axios.post(`${API_BASE}/communication/upload`, form3, {
                headers: {
                    ...form3.getHeaders(),
                    Authorization: `Bearer ${tokenUserA}`
                }
            });
            console.log(' [FAIL] 11MB PDF was accepted when it should be rejected: ' + res3.status);
        } catch (e: any) {
            if (e.response?.status === 400 && e.response?.data?.message?.includes('10MB')) {
                console.log(' [PASS] >10MB file rejected with 400 Bad Request: ' + e.response.data.message);
            } else {
                console.log(' [PARTIAL] >10MB rejected with status ' + e.response?.status + ': ' + (e.response?.data?.message || e.message));
            }
        }

        // Test 4: .exe file -> REJECT
        console.log('\nTest 4: .exe malicious file upload...');
        const fileExe = path.join(tempDir, 'malware.exe');
        fs.writeFileSync(fileExe, Buffer.from('MZ executable dummy binary'));
        try {
            const form4 = new FormData();
            form4.append('file', fs.createReadStream(fileExe));
            const res4 = await axios.post(`${API_BASE}/communication/upload`, form4, {
                headers: {
                    ...form4.getHeaders(),
                    Authorization: `Bearer ${tokenUserA}`
                }
            });
            console.log(' [FAIL] .exe file was accepted when it should be rejected: ' + res4.status);
        } catch (e: any) {
            if (e.response?.status === 400) {
                console.log(' [PASS] .exe rejected with 400 Bad Request: ' + e.response.data.message);
            } else {
                console.log(' [FAIL] .exe unexpected error: ' + (e.response?.data?.message || e.message));
            }
        }

        // Test 5: Unsupported file type (.sh script) -> REJECT
        console.log('\nTest 5: Unsupported script (.sh)...');
        const fileSh = path.join(tempDir, 'script.sh');
        fs.writeFileSync(fileSh, Buffer.from('#!/bin/bash\necho hello'));
        try {
            const form5 = new FormData();
            form5.append('file', fs.createReadStream(fileSh));
            const res5 = await axios.post(`${API_BASE}/communication/upload`, form5, {
                headers: {
                    ...form5.getHeaders(),
                    Authorization: `Bearer ${tokenUserA}`
                }
            });
            console.log(' [FAIL] .sh file was accepted when it should be rejected: ' + res5.status);
        } catch (e: any) {
            if (e.response?.status === 400) {
                console.log(' [PASS] .sh rejected with 400 Bad Request: ' + e.response.data.message);
            } else {
                console.log(' [FAIL] .sh unexpected error: ' + (e.response?.data?.message || e.message));
            }
        }

    } finally {
        // Cleanup temp files
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }

    console.log('\n=== UPLOAD TESTS FINISHED ===');
}

runUploadTests();
