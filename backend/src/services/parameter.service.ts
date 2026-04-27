/**
 * Parameter Service
 * Business logic for Ericsson parameter operations
 */
import { ParameterModel, ParameterSearchFilters } from '../models/parameter.model.js';
import { logger } from '../utils/logger.js';

export class ParameterService {
  /**
   * Get parameter by ID
   */
  static async getParameterById(parameterId: number) {
    return await ParameterModel.getById(parameterId);
  }
  
  /**
   * Search parameters
   */
  static async searchParameters(filters: ParameterSearchFilters) {
    return await ParameterModel.search(filters);
  }
  
  /**
   * Get all MO classes
   */
  static async getMOClasses() {
    return await ParameterModel.getMOClasses();
  }
  
  /**
   * Get parameters for MO class
   */
  static async getParametersByMOClass(moClass: string) {
    return await ParameterModel.getByMOClass(moClass);
  }
  
  /**
   * Get parameter statistics
   */
  static async getStatistics() {
    return await ParameterModel.getStatistics();
  }
  
  /**
   * Validate parameter value
   */
  static validateValue(parameter: any, value: any): { valid: boolean; error?: string } {
    // Type validation
    if (parameter.dataType) {
      const type = parameter.dataType.toLowerCase();
      
      if (type.includes('int') && !Number.isInteger(Number(value))) {
        return { valid: false, error: 'Value must be an integer' };
      }
      
      if (type.includes('bool') && typeof value !== 'boolean') {
        return { valid: false, error: 'Value must be boolean' };
      }
    }
    
    // Range validation
    if (parameter.rangeValues) {
      const range = parameter.rangeValues;
      
      if (range.includes('..')) {
        const [min, max] = range.split('..').map(Number);
        const numValue = Number(value);
        
        if (!isNaN(min) && !isNaN(max) && !isNaN(numValue)) {
          if (numValue < min || numValue > max) {
            return { valid: false, error: `Value must be between ${min} and ${max}` };
          }
        }
      }
    }
    
    // Read-only check
    if (parameter.readOnly) {
      return { valid: false, error: 'Parameter is read-only' };
    }
    
    return { valid: true };
  }
}
