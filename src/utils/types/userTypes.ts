import { Request } from "express";

// ============================================================
// USER TYPES — v2.0
// seller role removed. agent role added.
// ============================================================

export type UserRole = 'admin' | 'agent' | 'customer' | 'guest';

export interface User {
    user_id: string;
    name: string;
    email: string;
    password?: string;
    role: UserRole;
    created_at?: Date;
    updated_at?: Date;
}

declare global {
    namespace Express {
        interface User {
            user_id: string;
            name: string;
            email: string;
            role: UserRole;
        }
    }
}

export interface UserRequest extends Request {
    user?: User;
}