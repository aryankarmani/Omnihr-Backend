import { Request } from 'express';
import 'multer';

declare global {
    namespace Express {
        namespace Multer {
            interface File {
                fieldname: string;
                originalname: string;
                encoding: string;
                mimetype: string;
                size: number;
                destination: string;
                filename: string;
                path: string;
                buffer: Buffer;
            }
        }
        interface Request {
            user?: {
                id: number;
                email: string;
                name?: string;
                role?: string;
                tenantId: string;
                roleId?: number;
            };
            file?: Multer.File;
            files?: { [fieldname: string]: Multer.File[] } | Multer.File[];
        }
    }
}
