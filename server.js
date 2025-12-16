const express = require('express');
const cors = require('cors');
const argon2 = require('argon2');
const pool = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - IMPORTANTE: limit aumentado para imágenes
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Inicializar usuarios de prueba
async function initUsers() {
    try {
        const adminExists = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
        
        if (adminExists.rows.length === 0) {
            const adminHash = await argon2.hash('admin123');
            const userHash = await argon2.hash('user123');
            
            await pool.query(
                'INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4)',
                ['admin', adminHash, 'Administrador', 'admin']
            );
            
            await pool.query(
                'INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4)',
                ['user', userHash, 'Usuario Normal', 'user']
            );
            
            // Crear eventos de ejemplo
            const adminId = (await pool.query('SELECT id FROM users WHERE username = $1', ['admin'])).rows[0].id;
            const userId = (await pool.query('SELECT id FROM users WHERE username = $1', ['user'])).rows[0].id;
            
            await pool.query(
                'INSERT INTO events (title, description, date, location, capacity, attendees, created_by, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                ['Conferencia Tech 2024', 'Conferencia sobre tecnología', '2024-12-20', 'Centro de Convenciones', 200, 45, adminId, 'Tecnología']
            );
            
            await pool.query(
                'INSERT INTO events (title, description, date, location, capacity, attendees, created_by, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                ['Workshop React', 'Taller práctico de React', '2024-12-15', 'Sala 101', 30, 28, userId, 'Taller']
            );
            
            console.log('✅ Usuarios y eventos de prueba creados');
        }
    } catch (error) {
        console.error('❌ Error inicializando datos:', error);
    }
}

// ==================== RUTAS DE AUTENTICACIÓN ====================

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'username', message: 'Usuario no existe' });
        }
        
        const user = result.rows[0];
        const validPassword = await argon2.verify(user.password_hash, password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'password', message: 'Contraseña incorrecta' });
        }
        
        const { password_hash, ...userWithoutPassword } = user;
        
        res.json({ user: userWithoutPassword });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'general', message: 'Error del servidor' });
    }
});

// Registro
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, name } = req.body;
        
        if (!username || !password || !name) {
            return res.status(400).json({ error: 'general', message: 'Todos los campos son requeridos' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'password', message: 'La contraseña debe tener al menos 6 caracteres' });
        }
        
        const userExists = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'username', message: 'El usuario ya existe' });
        }
        
        const passwordHash = await argon2.hash(password);
        
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, name, role',
            [username, passwordHash, name, 'user']
        );
        
        res.status(201).json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'general', message: 'Error del servidor' });
    }
});

// ==================== RUTAS DE EVENTOS ====================

// Obtener todos los eventos
app.get('/api/events', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM events ORDER BY date DESC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo eventos:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Crear evento
app.post('/api/events', async (req, res) => {
    try {
        const { title, description, date, location, latitude, longitude, capacity, category, createdBy, image } = req.body;
        
        console.log('=== CREANDO EVENTO ===');
        console.log('Category:', category);
        console.log('Image:', image ? `Tiene imagen (${image.length} caracteres)` : 'Sin imagen');
        
        const result = await pool.query(
            `INSERT INTO events (title, description, date, location, latitude, longitude, capacity, category, created_by, image, attendees) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0) 
             RETURNING *`,
            [title, description, date, location, latitude, longitude, capacity, category || 'Otro', createdBy, image]
        );
        
        console.log('✅ Evento creado con ID:', result.rows[0].id);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('❌ Error creando evento:', error);
        res.status(500).json({ error: 'Error del servidor', message: error.message });
    }
});

// Actualizar evento
app.put('/api/events/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, date, location, latitude, longitude, capacity, category, image } = req.body;
        
        console.log('=== ACTUALIZANDO EVENTO ===');
        console.log('Event ID:', id);
        console.log('Category:', category);
        console.log('Image:', image ? `Tiene imagen (${image.length} caracteres)` : 'Sin imagen');
        
        const result = await pool.query(
            `UPDATE events 
             SET title = $1, description = $2, date = $3, location = $4, 
                 latitude = $5, longitude = $6, capacity = $7, category = $8, image = $9
             WHERE id = $10 
             RETURNING *`,
            [title, description, date, location, latitude, longitude, capacity, category || 'Otro', image, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado' });
        }
        
        console.log('✅ Evento actualizado:', result.rows[0].id);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ Error actualizando evento:', error);
        res.status(500).json({ error: 'Error del servidor', message: error.message });
    }
});

// Eliminar evento
app.delete('/api/events/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const id = Number(req.params.id);

        await client.query('BEGIN');

        await client.query(
            'DELETE FROM registrations WHERE event_id = $1',
            [id]
        );

        const result = await client.query(
            'DELETE FROM events WHERE id = $1',
            [id]
        );

        await client.query('COMMIT');

        res.json({ message: 'Evento y registros eliminados' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Error eliminando evento' });
    } finally {
        client.release();
    }
});

// ==================== INSCRIPCIONES ====================

// Inscribirse a evento
app.post('/api/events/:id/register', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        const event = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (!event.rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });

        if (event.rows[0].attendees >= event.rows[0].capacity) {
            return res.status(400).json({ error: 'Evento lleno' });
        }

        await pool.query(
            'INSERT INTO registrations (user_id, event_id) VALUES ($1, $2)',
            [userId, id]
        );

        await pool.query(
            'UPDATE events SET attendees = attendees + 1 WHERE id = $1',
            [id]
        );

        // Crear notificación
        await pool.query(
            'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
            [userId, `Te has inscrito exitosamente en el evento "${event.rows[0].title}"`]
        );

        res.json({ message: 'Inscripción exitosa' });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya estás inscrito en este evento' });
        }
        console.error('Error en inscripción:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Desinscribirse de evento
app.post('/api/events/:id/unregister', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        await client.query('BEGIN');
        
        const registration = await client.query(
            'SELECT * FROM registrations WHERE user_id = $1 AND event_id = $2',
            [userId, id]
        );
        
        if (registration.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No estás inscrito en este evento' });
        }
        
        await client.query(
            'DELETE FROM registrations WHERE user_id = $1 AND event_id = $2',
            [userId, id]
        );
        
        await client.query(
            'UPDATE events SET attendees = attendees - 1 WHERE id = $1',
            [id]
        );
        
        await client.query('COMMIT');
        
        res.json({ message: 'Inscripción cancelada exitosamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en desinscripción:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// Obtener IDs de eventos en los que un usuario está inscrito
app.get('/api/registrations/user/:userId', async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        const { rows } = await pool.query(
            'SELECT event_id FROM registrations WHERE user_id = $1',
            [userId]
        );

        res.json(rows.map(r => r.event_id));
    } catch (error) {
        console.error('Error obteniendo registros del usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==================== NOTIFICACIONES ====================

// Obtener notificaciones de un usuario
app.get('/api/notifications/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await pool.query(
            'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo notificaciones:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Marcar notificación como leída
app.patch('/api/notifications/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(
            'UPDATE notifications SET read = true WHERE id = $1',
            [id]
        );
        res.json({ message: 'Notificación marcada como leída' });
    } catch (error) {
        console.error('Error marcando notificación:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==================== INICIAR SERVIDOR ====================
app.listen(PORT, async () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    await initUsers();
});