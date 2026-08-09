CREATE TRIGGER `visits_closed_insert_guard`
BEFORE INSERT ON `visits`
WHEN NEW.`status` = 'CLOSED'
BEGIN
  SELECT RAISE(ABORT, 'visits cannot be inserted CLOSED');
END;
