import { Request } from 'express';
import 'multer';

declare global {
    namespace Express {
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
