import { Injectable, Logger, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MapperPort } from '../../domain/ports/data-source.port.js';

/**
 * Decorator to register a mapper class
 */
export function RegisterMapper(identifier: string) {
  return function <T extends Type<MapperPort>>(target: T) {
    Reflect.defineMetadata('mapper:identifier', identifier, target);
    return target;
  };
}

/**
 * Get the mapper identifier from a class
 */
export function getMapperIdentifier(target: Type<MapperPort>): string | undefined {
  return Reflect.getMetadata('mapper:identifier', target);
}

/**
 * Registry for mapper classes
 * Allows dynamic resolution of mappers based on mapping_class string from credentials
 */
@Injectable()
export class MapperRegistry {
  private readonly logger = new Logger(MapperRegistry.name);
  private readonly mappers = new Map<string, Type<MapperPort>>();

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Register a mapper class with an identifier
   */
  register(identifier: string, mapperClass: Type<MapperPort>): void {
    this.logger.log(`Registering mapper: ${identifier}`);
    this.mappers.set(identifier, mapperClass);
  }

  /**
   * Get a mapper instance by identifier
   * The identifier can be:
   * - A simple name like "byu" or "default"
   * - A full class path like "App\\Repositories\\Tenant\\Netsuite\\Mappings\\ByuMapping"
   */
  async getMapper(identifier: string): Promise<MapperPort | null> {
    // Normalize the identifier (extract class name from full path)
    const normalizedId = this.normalizeIdentifier(identifier);
    
    const mapperClass = this.mappers.get(normalizedId);
    if (!mapperClass) {
      this.logger.warn(`Mapper not found for identifier: ${identifier} (normalized: ${normalizedId})`);
      return null;
    }

    try {
      // Use NestJS DI to create the mapper instance
      return await this.moduleRef.create(mapperClass);
    } catch (error) {
      this.logger.error(`Failed to create mapper instance: ${error}`);
      return null;
    }
  }

  /**
   * Check if a mapper exists for the given identifier
   */
  hasMapper(identifier: string): boolean {
    const normalizedId = this.normalizeIdentifier(identifier);
    return this.mappers.has(normalizedId);
  }

  /**
   * Get all registered mapper identifiers
   */
  getRegisteredMappers(): string[] {
    return Array.from(this.mappers.keys());
  }

  /**
   * Normalize a mapper identifier
   * Converts full class paths to simple names
   * e.g., "App\\Repositories\\Tenant\\Netsuite\\Mappings\\ByuMapping" -> "byu"
   */
  private normalizeIdentifier(identifier: string): string {
    // If it's a full class path, extract the class name
    if (identifier.includes('\\')) {
      const parts = identifier.split('\\');
      const className = parts[parts.length - 1];
      // Remove "Mapping" suffix and convert to lowercase
      return className.replace(/Mapping$/i, '').toLowerCase();
    }
    
    // Already a simple identifier
    return identifier.toLowerCase();
  }
}

