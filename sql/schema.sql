CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  password_reset_token_hash CHAR(64) NULL,
  password_reset_expires_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  imdb_id VARCHAR(15) NOT NULL UNIQUE,
  title_en VARCHAR(255) NOT NULL,
  title_ka VARCHAR(255) NULL,
  release_year SMALLINT UNSIGNED NULL,
  imdb_rating DECIMAL(3,1) NULL,
  genre VARCHAR(255) NULL,
  director VARCHAR(255) NULL,
  actors TEXT NULL,
  poster_url TEXT NULL,
  backdrop_url TEXT NULL,
  video_url TEXT NULL,
  video_type VARCHAR(20) NOT NULL DEFAULT 'movie',
  description TEXT NULL,
  poster_rights_basis VARCHAR(40) NULL,
  poster_rights_evidence TEXT NULL,
  poster_license_url TEXT NULL,
  poster_attribution TEXT NULL,
  backdrop_rights_basis VARCHAR(40) NULL,
  backdrop_rights_evidence TEXT NULL,
  backdrop_license_url TEXT NULL,
  backdrop_attribution TEXT NULL,
  video_rights_basis VARCHAR(40) NULL,
  video_rights_evidence TEXT NULL,
  video_license_url TEXT NULL,
  video_attribution TEXT NULL,
  description_rights_basis VARCHAR(40) NULL,
  description_rights_evidence TEXT NULL,
  views INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_movies_rating (imdb_rating),
  INDEX idx_movies_year (release_year)
);

CREATE TABLE IF NOT EXISTS comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  movie_id BIGINT UNSIGNED NOT NULL,
  comment VARCHAR(1200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_comments_movie (movie_id, created_at),
  CONSTRAINT fk_comment_movie FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  message VARCHAR(1500) NOT NULL,
  reply TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS copyright_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  notice_type VARCHAR(30) NOT NULL,
  reporter_name VARCHAR(255) NOT NULL,
  reporter_identifier VARCHAR(120) NOT NULL,
  reporter_address TEXT NOT NULL,
  reporter_phone VARCHAR(80) NOT NULL,
  reporter_email VARCHAR(254) NOT NULL,
  work_description TEXT NOT NULL,
  claim_basis TEXT NOT NULL,
  reported_urls TEXT NOT NULL,
  supporting_url TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'received',
  admin_note TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  handled_at DATETIME NULL,
  INDEX idx_copyright_reports_status (status, created_at)
);
