-- =========================================================================
-- ESQUEMA DE BASE DE DATOS PARA SISTEMA DE NOTIFICACIONES DE TIENDA
-- Ejecutar en el Editor SQL de tu panel en Supabase (https://supabase.com)
-- =========================================================================

-- Habilitar extensión UUID si no está activa
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABLA DE USUARIOS DE LA APLICACIÓN (ADMIN Y EMPLEADOS)
CREATE TABLE IF NOT EXISTS public.app_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'usuario')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. TABLA DE SESIONES DE USUARIO (CUANDO UN EMPLEADO/ADMIN SE CONECTA)
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    ip_address TEXT,
    user_agent TEXT
);

-- 3. TABLA GLOBAL DE NOTIFICACIONES RECIBIDAS
CREATE TABLE IF NOT EXISTS public.notifications (
    id TEXT PRIMARY KEY,
    app_name TEXT NOT NULL,
    package_name TEXT,
    title TEXT,
    text TEXT,
    big_text TEXT,
    post_time BIGINT,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT DEFAULT 'new'
);

-- 4. TABLA DE NOTIFICACIONES VINCULADAS A SESIONES
CREATE TABLE IF NOT EXISTS public.session_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.user_sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    notification_id TEXT,
    app_name TEXT NOT NULL,
    title TEXT,
    text TEXT,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT DEFAULT 'new'
);

-- Desactivar RLS o habilitar acceso para la clave pública anon
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_notifications ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para clave anon / servicio
DROP POLICY IF EXISTS "Anon Full Access Users" ON public.app_users;
CREATE POLICY "Anon Full Access Users" ON public.app_users FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Full Access Sessions" ON public.user_sessions;
CREATE POLICY "Anon Full Access Sessions" ON public.user_sessions FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Full Access Notifications" ON public.notifications;
CREATE POLICY "Anon Full Access Notifications" ON public.notifications FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Full Access Session Notifications" ON public.session_notifications;
CREATE POLICY "Anon Full Access Session Notifications" ON public.session_notifications FOR ALL TO anon USING (true) WITH CHECK (true);

-- Insertar usuario administrador por defecto: admin / admin123
-- Hash bcrypt para 'admin123'
INSERT INTO public.app_users (username, password_hash, full_name, role, is_active)
VALUES (
    'admin',
    '$2a$10$w09yYyAov4YkHj4Uq.P0w.hD1oHwK0K35V8XbB1c/g19g2588s7yC',
    'Administrador Principal',
    'admin',
    true
)
ON CONFLICT (username) DO NOTHING;
