import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';

const generateToken = (id) => {
  return jwt.sign({ id }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
};

const isValidEmail = (email) => (
  typeof email === 'string'
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
);

export const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(409).json({ error: 'User already exists' });
    }
    // Public registration must never grant a privileged role.
    const user = await User.create({ name: name.trim(), email: normalizedEmail, password });
    res.status(201).json({
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'User already exists' });
    }
    next(error);
  }
};

export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!isValidEmail(email) || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'Valid email and password are required' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (user && (await user.matchPassword(password))) {
      res.json({
        token: generateToken(user._id),
        user: { id: user._id, name: user.name, email: user.email, role: user.role }
      });
    } else {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    next(error);
  }
};
